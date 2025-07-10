const EventEmitter = require('events');
const loggerModule = require('../../../utils/logger');
const Colibri2Session = require('./colibri2Session');
const {
    ColibriAllocation,
    ColibriAllocationFailedException,
    BridgeSelectionFailedException,
    ConferenceAlreadyExistsException
} = require('./colibriAllocation');
// const Bridge = require('../../bridge').Bridge; // Assuming a Bridge class definition path
// const BridgeSelector = require('../../bridgeSelector'); // Assuming BridgeSelector class path
// const ConferenceSourceMap = require('../../../common/conference/source/conferenceSourceMap');
// const IceUdpTransportPacketExtension = require('./colibri2Extensions'); // Placeholder for parsed transport
// const InitialLastN = require('./colibri2Extensions'); // Placeholder

// Placeholder for ParticipantInfo data structure
class ParticipantInfo {
    constructor(allocationParams, session) {
        this.id = allocationParams.id;
        this.statsId = allocationParams.statsId;
        this.visitor = allocationParams.visitor;
        this.useSctp = allocationParams.useSctp; // Whether SCTP/datachannel is requested
        this.sources = allocationParams.sources; // Initial EndpointSourceSet
        this.transport = null; // Will be populated after allocation
        this.session = session; // The Colibri2Session this participant belongs to
        this.audioMuted = allocationParams.startAudioMuted || true;
        this.videoMuted = allocationParams.startVideoMuted || true;
    }
    toJson() {
        return {
            id: this.id,
            statsId: this.statsId,
            visitor: this.visitor,
            useSctp: this.useSctp,
            audioMuted: this.audioMuted,
            videoMuted: this.videoMuted,
            sessionId: this.session?.id, // Colibri conference ID
            bridge: this.session?.bridge.getJid()?.toString()
        };
    }
}


/**
 * Implements ColibriSessionManager using colibri2.
 * This class manages Colibri2 sessions with one or more JVBs for a single Jitsi Meet conference.
 */
class ColibriV2SessionManager extends EventEmitter {
    /**
     * @param {ManagedXmppConnection} xmppConnection - The XMPP connection for sending Colibri IQs.
     * @param {BridgeSelector} bridgeSelector - The bridge selector instance.
     * @param {string} conferenceName - The MUC room name (bare JID string).
     * @param {string} meetingId - The unique meeting ID for the conference.
     * @param {boolean} rtcStatsEnabled - Whether RTC stats are enabled.
     * @param {string|null} pinnedBridgeVersion - Specific JVB version to use, if pinned.
     * @param {Logger} parentLogger - The parent logger instance.
     */
    constructor(
        xmppConnection,
        bridgeSelector,
        conferenceName,
        meetingId,
        rtcStatsEnabled,
        pinnedBridgeVersion,
        parentLogger
    ) {
        super();
        this.xmppConnection = xmppConnection;
        this.bridgeSelector = bridgeSelector;
        this.conferenceName = conferenceName;
        this.meetingId = meetingId;
        this.rtcStatsEnabled = rtcStatsEnabled;
        this.pinnedBridgeVersion = pinnedBridgeVersion; // Used by bridgeSelector
        this.logger = parentLogger.child({ component: 'ColibriV2SessionManager', conference: this.conferenceName });

        // relayId (bridge.relayId string) -> Colibri2Session instance
        this.sessions = new Map();
        // participantId (string) -> ParticipantInfo instance
        this.participants = new Map();
        // Colibri2Session instance -> Array of ParticipantInfo instances
        this.participantsBySession = new Map();

        // TODO: Initialize topologySelectionStrategy based on config (BridgeConfig.config.topologyStrategy)
        // this.topologySelectionStrategy = new SomeTopologyStrategy();

        this.logger.info('ColibriV2SessionManager created.');
    }

    addListener(listener) { super.on('colibriEvent', listener); } // Simplistic mapping for now
    removeListener(listener) { super.removeListener('colibriEvent', listener); }

    // --- Public API matching ColibriSessionManager interface ---

    expire() {
        this.logger.info('Expiring all Colibri2 sessions.');
        this.sessions.forEach(session => {
            this.logger.debug(`Expiring session on bridge ${session.bridge.getJid()}`);
            session.expire(); // This should send expire IQ for the whole colibri conference
        });
        this.sessions.clear();
        this.participants.clear();
        this.participantsBySession.clear();
        this.emit('colibriEvent', { type: 'bridgeCountChanged', count: 0 });
    }

    removeParticipant(participantId) {
        this.logger.debug(`Request to remove participant ${participantId}`);
        const participantInfo = this.participants.get(participantId);
        if (participantInfo) {
            this.logger.info(`Removing participant ${participantInfo.id} from session ${participantInfo.session.id}`);
            // This will call participantInfo.session.expire([participantInfo])
            this._removeParticipantInfosBySession(new Map([[participantInfo.session, [participantInfo]]]));
        } else {
            this.logger.warn(`Cannot remove participant ${participantId}, no ParticipantInfo found.`);
        }
    }

    /**
     * @param {Set<string>} participantIds - Set of participant IDs to mute/unmute.
     * @param {boolean} doMute - True to mute, false to unmute.
     * @param {string} mediaType - MediaType.AUDIO or MediaType.VIDEO.
     * @returns {boolean} True if successful (at least attempted), false otherwise.
     */
    mute(participantIds, doMute, mediaType) {
        const participantsToMuteBySession = new Map();

        participantIds.forEach(id => {
            const pInfo = this.participants.get(id);
            if (!pInfo) {
                this.logger.error(`No ParticipantInfo for ${id}, cannot force mute.`);
                return; // continue forEach
            }
            // Check if state change is actually needed
            const noChangeNeeded = (mediaType === MediaType.AUDIO && pInfo.audioMuted === doMute) ||
                                   (mediaType === MediaType.VIDEO && pInfo.videoMuted === doMute);
            if (noChangeNeeded) return;

            if (mediaType === MediaType.AUDIO) pInfo.audioMuted = doMute;
            if (mediaType === MediaType.VIDEO) pInfo.videoMuted = doMute;

            if (!participantsToMuteBySession.has(pInfo.session)) {
                participantsToMuteBySession.set(pInfo.session, new Set());
            }
            participantsToMuteBySession.get(pInfo.session).add(pInfo);
        });

        participantsToMuteBySession.forEach((participantsSet, session) => {
            session.updateForceMute(participantsSet);
        });
        return true;
    }

    get bridgeCount() { return this.sessions.size; }

    get bridgeRegions() {
        const regions = new Set();
        this.sessions.forEach(session => {
            if (session.bridge.getRegion) regions.add(session.bridge.getRegion());
        });
        return regions;
    }

    getBridges() { // Returns Map<Bridge, ConferenceBridgeProperties>
        const bridgePropsMap = new Map();
        this.participantsBySession.forEach((pInfos, session) => {
            if (session.bridge.isOperational) { // Assuming bridge has isOperational
                 bridgePropsMap.set(session.bridge, { // ConferenceBridgeProperties like object
                    participantCount: pInfos.length,
                    isVisitor: pInfos.length > 0 ? pInfos[0].visitor : false
                    // TODO: stress, version, etc. from bridge object itself
                });
            }
        });
        return bridgePropsMap;
    }

    /**
     * Allocates Colibri channels for a participant.
     * @param {object} participantAllocationParams - Includes id, statsId, visitor, useSctp, sources, region, etc.
     * @returns {Promise<ColibriAllocation>}
     * @throws {BridgeSelectionFailedException | ColibriAllocationFailedException | ConferenceAlreadyExistsException}
     */
    async allocate(participantAllocationParams) {
        this.logger.info(`Allocating Colibri channels for participant ${participantAllocationParams.id}`);

        if (this.participants.has(participantAllocationParams.id)) {
            this.logger.error(`Participant ${participantAllocationParams.id} already exists in ColibriV2SessionManager.`);
            throw new Error('Participant already exists'); // Or a specific error type
        }

        const bridge = this.bridgeSelector.selectBridge(
            this.getBridges(),
            { region: participantAllocationParams.region, visitor: participantAllocationParams.visitor }, // ParticipantProperties
            this.pinnedBridgeVersion
        );

        if (!bridge) {
            this.emit('colibriEvent', { type: 'bridgeSelectionFailed' });
            throw new BridgeSelectionFailedException();
        }
        this.emit('colibriEvent', { type: 'bridgeSelectionSucceeded' });

        const { session, created: sessionJustCreated } = this._getOrCreateSession(bridge, participantAllocationParams.visitor);

        this.logger.info(
            `Selected bridge ${bridge.getJid()} for ${participantAllocationParams.id}. ` +
            `Session exists: ${!sessionJustCreated}, Visitor: ${participantAllocationParams.visitor}`
        );

        const participantInfo = new ParticipantInfo(participantAllocationParams, session);

        // This is where the StanzaCollector logic was. We'll await the IQ response.
        let responseIQ;
        try {
            // Add participant before sending request, to handle potential concurrent responses/failures
            this._addParticipantInfo(participantInfo);
            if (sessionJustCreated) {
                // TODO: this.topologySelectionStrategy.connectNode(this, session);
                // TODO: addNodeToMesh(session, ...);
                this.emit('colibriEvent', { type: 'bridgeCountChanged', count: this.sessions.size });
            } else {
                // TODO: Octo logic: if (!participantInfo.visitor) { getPathsFrom(session)... updateRemoteParticipant }
            }

            responseIQ = await session.sendAllocationRequest(participantInfo); // This needs to return the response IQ
            this.logger.debug(`Received Colibri response for ${participantInfo.id}: ${responseIQ?.toString()}`);
        } catch (error) { // Catch error from sendAllocationRequest (e.g. XMPP timeout)
             this.logger.error(`Colibri allocation request failed for ${participantInfo.id} on bridge ${bridge.getJid()}: ${error.message}`);
             this._handleAllocationError(error, session, participantInfo, true); // Assume bridge issue on timeout/send error
             throw error; // Rethrow original error or a ColibriAllocationFailedException
        }


        // Process response (synchronized block in Kotlin)
        // Using a simple lock here to simulate, though proper async mutex might be needed if complex.
        if (this._allocationResponseLock) {
            await this._allocationResponseLock; // Wait if another response is being processed
        }
        this._allocationResponseLock = (async () => {
            try {
                if (!this.sessions.has(session.bridge.getRelayId()) || this.sessions.get(session.bridge.getRelayId()) !== session) {
                    this.logger.info(`Ignoring response for session on ${session.bridge.getJid()} that's no longer active.`);
                    throw new ColibriAllocationFailedException("Session no longer active", false);
                }
                if (!this.participants.has(participantInfo.id) || this.participants.get(participantInfo.id) !== participantInfo) {
                     this.logger.info(`Ignoring response for participant ${participantInfo.id} that's no longer active.`);
                    throw new ColibriAllocationFailedException("Participant no longer active", false);
                }
                return this._handleColibriResponse(responseIQ, session, sessionJustCreated, participantInfo);
            } finally {
                this._allocationResponseLock = null;
            }
        })();
        return this._allocationResponseLock;
    }

    // Placeholder for the lock
    _allocationResponseLock = null;

    _getOrCreateSession(bridge, visitor) {
        let session = this.sessions.get(bridge.getRelayId());
        if (session) {
            return { session, created: false };
        }
        session = new Colibri2Session(this, bridge, visitor, this.logger);
        this.sessions.set(bridge.getRelayId(), session);
        return { session, created: true };
    }

    _addParticipantInfo(participantInfo) {
        this.participants.set(participantInfo.id, participantInfo);
        if (!this.participantsBySession.has(participantInfo.session)) {
            this.participantsBySession.set(participantInfo.session, []);
        }
        this.participantsBySession.get(participantInfo.session).push(participantInfo);
    }

    _removeParticipantInfo(participantInfo) {
        this.participants.delete(participantInfo.id);
        const sessionParticipants = this.participantsBySession.get(participantInfo.session);
        if (sessionParticipants) {
            const index = sessionParticipants.indexOf(participantInfo);
            if (index > -1) sessionParticipants.splice(index, 1);
            if (sessionParticipants.length === 0) {
                this.participantsBySession.delete(participantInfo.session);
            }
        }
    }

    _removeSession(session) {
        const removedBridgeRelayId = session.bridge.getRelayId();
        session.expire();
        this.sessions.delete(removedBridgeRelayId);

        const sessionParticipants = this.participantsBySession.get(session) || [];
        sessionParticipants.forEach(pInfo => this.participants.delete(pInfo.id));
        this.participantsBySession.delete(session);

        if (removedBridgeRelayId) {
            this.sessions.forEach(otherSession => otherSession.expireRelay(removedBridgeRelayId));
        }
        return sessionParticipants;
    }

    _handleAllocationError(error, session, participantInfo, defaultRemoveBridgeOnError) {
        let removeBridgeFlag = defaultRemoveBridgeOnError;
        if (error instanceof ColibriAllocationFailedException || error instanceof ConferenceAlreadyExistsException) {
            removeBridgeFlag = error.removeBridge;
        }

        if (removeBridgeFlag && session && this.sessions.has(session.bridge.getRelayId())) {
            this.logger.warn(`Removing bridge ${session.bridge.getJid()} due to allocation error: ${error.message}`);
            const removedParticipants = this._removeSession(session); // _removeSession also calls session.expire()
            const allRemovedOrFailed = new Set([...removedParticipants]);
            if (participantInfo) allRemovedOrFailed.add(participantInfo); // Ensure current participant is included if not already

            this.emit('colibriEvent', { type: 'bridgeRemoved', bridge: session.bridge, participantIds: Array.from(allRemovedOrFailed).map(p=>p.id) });
            this.emit('colibriEvent', { type: 'bridgeCountChanged', count: this.sessions.size });
        } else if (participantInfo) {
            this._removeParticipantInfo(participantInfo);
            // If only the participant is removed but the session remains, we might need to tell the session to expire just this endpoint
            session?.expire([participantInfo]);
        }
    }

    _handleColibriResponse(responseIQ, session, sessionWasJustCreated, participantInfo) {
        // Check if session or participant became inactive while awaiting response.
        // This check is crucial to prevent acting on stale data if the session/participant was removed
        // due to another event (e.g., bridge failure detected concurrently).
        if (!this.sessions.has(session.bridge.getRelayId()) || this.sessions.get(session.bridge.getRelayId()) !== session) {
            this.logger.info(`Ignoring response for session on ${session.bridge.getJid()} as it's no longer the active session for this bridge relayId.`);
            throw new ColibriAllocationFailedException("Session no longer active for this bridge relayId during response handling", false);
        }
        if (!this.participants.has(participantInfo.id) || this.participants.get(participantInfo.id) !== participantInfo) {
             this.logger.info(`Ignoring response for participant ${participantInfo.id} as they are no longer active or belong to a different session instance.`);
            throw new ColibriAllocationFailedException("Participant no longer active or changed session during response handling", false);
        }

        if (!responseIQ) { // Timeout
            session.bridge.setIsOperational(false);
            this._handleAllocationError(new ColibriAllocationFailedException("Timeout waiting for Colibri response", true), session, participantInfo, true);
            throw new ColibriAllocationFailedException("Timeout waiting for Colibri response", true);
        }

        if (responseIQ.attrs.type === 'error') {
            const parsedError = parseColibriError(responseIQ);
            this.logger.warn(
                `Colibri error response for ${participantInfo.id} on bridge ${session.bridge.getJid()}: `+
                `condition=${parsedError.condition}, colibriReason=${parsedError.colibri2Reason}, text=${parsedError.text}`
            );

            let specificException;
            let removeBridgeOnError = false;

            if (parsedError.condition === 'item-not-found' && parsedError.colibri2Reason === 'conference-not-found') {
                 specificException = new ColibriAllocationFailedException("Conference not found on bridge", true);
                 removeBridgeOnError = true;
            } else if (parsedError.condition === 'conflict' && parsedError.colibri2Reason === 'conference-already-exists') {
                 specificException = new ConferenceAlreadyExistsException("Conference already exists on bridge", true);
                 removeBridgeOnError = true;
            } else if (parsedError.condition === 'service-unavailable' && parsedError.colibri2Reason === 'graceful-shutdown') {
                session.bridge.setIsInGracefulShutdown(true);
                specificException = new ColibriAllocationFailedException("Bridge in graceful shutdown", true);
                removeBridgeOnError = true;
            } else if (parsedError.condition === 'service-unavailable' || parsedError.condition === 'internal-server-error') {
                 session.bridge.setIsOperational(false);
                 specificException = new ColibriAllocationFailedException(`Bridge error: ${parsedError.condition}`, true);
                 removeBridgeOnError = true;
            } else {
                specificException = new ColibriAllocationFailedException(`Colibri error: ${parsedError.condition || 'unknown'}`, false);
                // removeBridgeOnError remains false for bad-request etc.
            }
            this._handleAllocationError(specificException, session, participantInfo, removeBridgeOnError);
            throw specificException;
        }

        // Successful result IQ, parse it
        try {
            const parsedData = parseConferenceModifyResponse(responseIQ, participantInfo.id);

            if (session.id === null && parsedData.conferenceId) {
                session.id = parsedData.conferenceId;
                this.logger.info(`Colibri conference ID ${session.id} established for bridge ${session.bridge.getJid()}`);
            } else if (session.id !== parsedData.conferenceId && parsedData.conferenceId /* only error if bridge returned a *different* ID */) {
                this.logger.error(
                    `Mismatched conference ID from bridge ${session.bridge.getJid()}: existing session ID ${session.id}, ` +
                    `received ${parsedData.conferenceId} for endpoint ${participantInfo.id}. This is a critical state mismatch.`
                );
                const mismatchError = new ColibriAllocationFailedException("Mismatched conference ID from bridge", true);
                this._handleAllocationError(mismatchError, session, participantInfo, true);
                throw mismatchError;
            }
            // If session.id was already set and parsedData.conferenceId is null (e.g. endpoint-expired response), it's not a mismatch.

            if (parsedData.endpointFeedbackSources) {
                session.feedbackSources = parsedData.endpointFeedbackSources;
            }

            participantInfo.transport = parsedData.endpointTransport;

            return new ColibriAllocation(
                parsedData.endpointFeedbackSources || EndpointSourceSet.EMPTY,
                parsedData.endpointTransport,
                session.bridge.getRegion ? session.bridge.getRegion() : null,
                session.id, // This must be set now if it wasn't, or match existing
                parsedData.endpointSctpPort
            );
        } catch (parseError) {
            this.logger.error(`Failed to parse successful Colibri response for ${participantInfo.id} on bridge ${session.bridge.getJid()}: ${parseError.message}`, responseIQ.toString());
            const wrappedError = new ColibriAllocationFailedException(`Failed to parse Colibri response: ${parseError.message}`, false);
            this._handleAllocationError(wrappedError, session, participantInfo, false);
            throw wrappedError;
        }
    }


    updateParticipant(participantId, transport, sources, initialLastN, suppressLocalBridgeUpdate = false) {
        this.logger.info(`Updating Colibri participant ${participantId}`);
        const participantInfo = this.participants.get(participantId);
        if (!participantInfo) {
            this.logger.error(`No ParticipantInfo for ${participantId} to update.`);
            return;
        }
        if (!suppressLocalBridgeUpdate) {
            participantInfo.session.updateParticipant(participantInfo, transport, sources, initialLastN);
        }
        if (sources) {
            participantInfo.sources = sources; // Update local cache
            // TODO: Octo logic: if (!participantInfo.visitor) { getPathsFrom... updateRemoteParticipant }
        }
    }

    getBridgeSessionId(participantId) {
        return this.participants.get(participantId)?.session?.id || null;
    }

    removeBridge(bridge) { // bridge is Bridge instance
        const sessionToRemove = this.sessions.get(bridge.getRelayId());
        if (!sessionToRemove) return [];

        this.logger.info(`Removing bridge: ${bridge.getJid()}`);
        const removedParticipants = this._removeSession(sessionToRemove);

        this.emit('colibriEvent', { type: 'bridgeCountChanged', count: this.sessions.size });

        const removedParticipantIds = removedParticipants.map(pInfo => pInfo.id);
        this.logger.info(`Removed participants due to bridge removal: ${removedParticipantIds.join(', ')}`);
        return removedParticipantIds;
    }


    // --- Octo/Relay methods (stubs for now) ---
    addLinkBetween(session, otherSession, meshId) {
        this.logger.info(`Octo: Add link between ${session.bridge.getJid()} and ${otherSession.bridge.getJid()} for mesh ${meshId}`);
        // const participantsBehindSession = ... getNodesBehind ... getVisibleSessionParticipants ...
        // const participantsBehindOtherSession = ...
        // session.createRelay(otherSession.relayId, participantsBehindOtherSession, true, meshId);
        // otherSession.createRelay(session.relayId, participantsBehindSession, false, meshId);
    }
    removeLinkTo(session, otherSession) {
        this.logger.info(`Octo: Remove link from ${session.bridge.getJid()} to ${otherSession.bridge.getJid()}`);
        // otherSession.relayId?.let { session.expireRelay(it); }
    }
    setRelayTransport(session, transport, relayId) { // session is the one that received transport for its relay
        this.logger.info(`Octo: Set relay transport from ${session.bridge.getJid()} for relay ${relayId}`);
        // const otherSession = Array.from(this.sessions.values()).find(s => s.relayId === relayId);
        // otherSession?.setRelayTransport(transport, session.relayId);
    }

    // --- Debug ---
    get debugState() {
        const state = { participants: {}, sessions: {} };
        this.participants.forEach((pInfo, pId) => {
            state.participants[pId] = pInfo.toJson();
        });
        this.sessions.forEach((session, relayId) => {
            const sessionJson = session.toJson();
            sessionJson.participants = (this.participantsBySession.get(session) || []).map(p => p.id);
            state.sessions[session.bridge.getJid()?.toString() || relayId || 'unknown-bridge'] = sessionJson;
        });
        return state;
    }

    /**
     * Internal helper to manage removing participant info from local maps
     * and triggering session expiration if the session becomes empty.
     */
    _removeParticipantInfosBySession(mapOfSessionToParticipantInfos) {
        let anySessionRemoved = false;
        const allRemovedParticipants = new Set();

        mapOfSessionToParticipantInfos.forEach((pInfosToRemove, session) => {
            this.logger.debug(`Removing ${pInfosToRemove.length} participants from session ${session.id} on ${session.bridge.getJid()}`);
            pInfosToRemove.forEach(pInfo => {
                this._removeParticipantInfo(pInfo);
                allRemovedParticipants.add(pInfo);
            });

            if (!this.participantsBySession.has(session) || this.participantsBySession.get(session).length === 0) {
                this.logger.info(`Session ${session.id} on ${session.bridge.getJid()} has no remaining participants. Removing session.`);
                this._removeSession(session); // This calls session.expire() for the whole colibri conference
                anySessionRemoved = true;
            } else {
                session.expire(pInfosToRemove); // Expire only specific endpoints
            }
        });

        if (anySessionRemoved) {
            this.emit('colibriEvent', { type: 'bridgeCountChanged', count: this.sessions.size });
        }
        return allRemovedParticipants;
    }

    // --- Event handling from Colibri2Session (called by Colibri2Session instances) ---
    /** Called by Colibri2Session when it fails irrecoverably (e.g. bridge fails to respond) */
    sessionFailed(session) { // session is a Colibri2Session instance
        this.logger.warn(`Colibri2Session for bridge ${session.bridge.getJid()} reported failure.`);
        if (this.sessions.get(session.bridge.getRelayId()) === session) {
            const removedParticipants = this._removeSession(session); // This also removes from this.sessions
            this.emit('colibriEvent', { type: 'bridgeRemoved', bridge: session.bridge, participantIds: removedParticipants.map(p=>p.id) });
            this.emit('colibriEvent', { type: 'bridgeCountChanged', count: this.sessions.size });
        } else {
            this.logger.info(`Session failure reported for an already removed/replaced session on bridge ${session.bridge.getJid()}`);
        }
    }

    /** Called by Colibri2Session when a specific endpoint fails (e.g. bridge reports error for it) */
    endpointFailed(session, endpointId) { // session is the Colibri2Session reporting the failure
        this.logger.warn(`Endpoint ${endpointId} on bridge ${session.bridge.getJid()} reported failure.`);
        const participantInfo = this.participants.get(endpointId);
        if (participantInfo && participantInfo.session === session) {
            this._removeParticipantInfo(participantInfo);
            this.emit('colibriEvent', { type: 'endpointRemoved', endpointId });
        } else {
            this.logger.error(`Cannot find participant info for failed endpoint ${endpointId} on session ${session.id}, or participant is on a different session.`);
        }
    }

}

module.exports = ColibriV2SessionManager;
