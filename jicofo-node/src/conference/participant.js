const loggerModule = require('../utils/logger');
const { JidUtils } = require('../config/serviceConfigs');
const RateLimit = require('../common/rateLimit');
const { JingleSession, JingleAction: JingleActionEnum } = require('../common/xmpp/jingle/jingleSession');
const { SourceSignaling, AddOrRemove } = require('./sourceSignaling'); // Import SourceSignaling
const { Features } = require('../xmpp/features');

// Placeholder for ConferenceConfig access
const ConferenceConfig = {
    config: {
        // Default values from Participant.kt or a central config spot
        restartRequestMinIntervalMs: 5000, // Example: 5 seconds
        restartRequestMaxRequests: 3,    // Example
        restartRequestIntervalMs: 60000, // Example: 60 seconds
        getSourceSignalingDelayMs: (participantCount) => 200, // Example
        useSsrcRewriting: false, // Example
        stripSimulcast: false // Example
    }
};

class Participant {
    constructor(
        chatMember, // Instance of ChatRoomMember from chatRoom.js
        conference, // Instance of JitsiMeetConference
        jingleIqRequestHandler, // Handler for Jingle IQs from XmppServices
        parentLogger,
        supportedFeatures = Features.defaultFeatures, // Assuming Features.defaultFeatures is defined
        clock = Date // For RateLimit and timing
    ) {
        this.chatMember = chatMember;
        this.conference = conference;
        this.jingleIqRequestHandler = jingleIqRequestHandler; // Will be used by JingleSession
        this.supportedFeatures = new Set(supportedFeatures); // Ensure it's a Set
        this.clock = clock;

        this.endpointId = this.chatMember.getName(); // Nickname from MUC JID resource part
        this.logger = (parentLogger || loggerModule).child({ participant: this.endpointId });

        this.createdInstant = this.clock.now();

        // Ensure features from chatMember are used if available and valid
        if (chatMember.features instanceof Set && chatMember.features.size > 0) {
            this.supportedFeatures = chatMember.features;
        } else if (supportedFeatures instanceof Set) {
            this.supportedFeatures = supportedFeatures;
        } else {
            this.supportedFeatures = Features.defaultFeatures; // Fallback
        }

        this.jingleSession = null;
        this.inviteRunnable = null; // Placeholder for async invite task/promise + cancel logic

        this.rateLimitRestartRequests = new RateLimit({
            minIntervalMs: ConferenceConfig.config.restartRequestMinIntervalMs,
            maxRequests: ConferenceConfig.config.restartRequestMaxRequests,
            intervalMs: ConferenceConfig.config.restartRequestIntervalMs,
            clock: this.clock
        });

        // Placeholder for SourceSignaling
        this.sourceSignaling = new SourceSignaling(
            this.hasAudioSupport(),
            this.hasVideoSupport(),
            // Get stripSimulcast from global config via conference service for consistency
            this.conference.jicofoSrv.jicofoConfig.getOptionalConfig('conference.stripSimulcast', true)
        );
        // this.sourceSignaling = { // Mocked - REMOVED
        //     addSources: (sources) => this.logger.debug('SourceSignaling.addSources called (mocked)', sources),
        //     removeSources: (sources) => this.logger.debug('SourceSignaling.removeSources called (mocked)', sources),
        //     reset: (sources) => { this.logger.debug('SourceSignaling.reset called (mocked)', sources); return {}; /* mock ConferenceSourceMap */ },
        //     update: () => { this.logger.debug('SourceSignaling.update called (mocked)'); return []; /* mock List<SourcesToAddOrRemove> */ },
        //     debugState: { mock: true }
        // };


        this.isUserParticipant = !this.chatMember.isJibri &&
                                 !this.chatMember.isTranscriber && // These are now on chatMember
                                 this.chatMember.role !== 'visitor';

        this.jingleRequestHandler = this._createJingleRequestHandler();

        this.logger.info(
            `Participant created. Endpoint ID: ${this.endpointId}, MUC JID: ${this.chatMember.getOccupantJid()}, ` +
            `Role: ${this.chatMember.role}, Affiliation: ${this.chatMember.affiliation}, ` +
            `Features: ${[...this.supportedFeatures].join(', ')}, isJibri: ${this.chatMember.isJibri}, ` +
            `isJigasi: ${this.chatMember.isJigasi}, isTranscriber: ${this.chatMember.isTranscriber}`
        );
    }

    get mucJid() {
        return this.chatMember.getOccupantJid();
    }

    get statId() {
        return this.chatMember.statsId;
    }

    get sources() {
        // This should represent the participant's *own* currently known/advertised sources.
        // For an initial offer from Jicofo, this participant (representing remote) has not advertised sources yet.
        // It gets populated when Jicofo receives source-add or session-accept from this participant.
        // The ValidatingConferenceSourceMap in JitsiMeetConference holds the conference-wide view.
        return this._sources || EndpointSourceSet.EMPTY;
    }

    /**
     * Sets the participant's sources. Called by JitsiMeetConference when sources are accepted.
     * @param {EndpointSourceSet} newSources
     */
    setSources(newSources) {
        // This is a simplified setter. The original Participant might merge or replace.
        // For now, direct replacement. This source set is what this participant *has*.
        this._sources = newSources;
        this.logger.debug(`Participant ${this.endpointId} sources updated.`);
    }


    durationSeconds() {
        return (this.clock.now() - this.createdInstant) / 1000.0;
    }

    // --- Feature Checks ---
    hasFeature(feature) { return this.supportedFeatures.has(feature); }
    hasSsrcRewritingSupport() { return this.hasFeature(Features.SSRC_REWRITING); } // V1 vs V2?
    useSsrcRewriting() { return ConferenceConfig.config.useSsrcRewriting && this.hasSsrcRewritingSupport(); }
    supportsJsonEncodedSources() { return this.hasFeature(Features.JSON_SOURCES); }
    hasRembSupport() { return this.hasFeature(Features.REMB); }
    hasTccSupport() { return this.hasFeature(Features.TCC); }
    hasRtxSupport() { return this.hasFeature(Features.RTX); }
    hasOpusRedSupport() { return this.hasFeature(Features.OPUS_RED); }
    hasAudioSupport() { return this.hasFeature(Features.AUDIO); }
    hasVideoSupport() { return this.hasFeature(Features.VIDEO); }
    hasAudioMuteSupport() { return this.hasFeature(Features.AUDIO_MUTE); }
    hasSctpSupport() { return this.hasFeature(Features.SCTP); }

    acceptRestartRequest() {
        return this.rateLimitRestartRequests.accept();
    }

    // --- Jingle Session Management ---
    createNewJingleSession() {
        if (this.jingleSession) {
            this.logger.info('Terminating existing Jingle session before creating a new one.');
            this.jingleSession.terminate(null /* reason */, null /* message */, false /* sendIq */); // Or use specific reason
        }

        const sid = `jingle_${Math.random().toString(36).substr(2, 9)}`; // Generate random SID
        // this.jingleSession = new JingleSession(
        //     sid,
        //     this.mucJid,
        //     this.jingleIqRequestHandler,
        //     this.chatMember.chatRoom.xmppConnection, // Needs chatRoom.xmppConnection
        //     this.jingleRequestHandler, // The inner handler
        //     ConferenceConfig.config.useJsonEncodedSources && this.supportsJsonEncodedSources()
        // );
        // Replace mock with actual JingleSession instantiation
        const encodeAsJson = this.conference.jicofoSrv.jicofoConfig.getOptionalConfig('jingle.encodeSourcesAsJson', false) &&
                             this.supportsJsonEncodedSources();

        this.jingleSession = new JingleSession(
            sid,
            this.mucJid,
            this.jingleIqRequestHandler, // This is the main JingleHandler from XmppServices
            this.chatMember.chatRoom.xmppConnection, // The ManagedXmppConnection via ChatRoom
            this.jingleRequestHandler, // Participant's own inner object for Jingle event callbacks
            encodeAsJson
        );
        this.logger.info(`Created new Jingle session: ${sid} (encodeAsJson: ${encodeAsJson})`);
        return this.jingleSession;
    }

    terminateJingleSession(reason, message, sendIq) {
        // Reason object might be { name: 'success', text: 'optional message' }
        // The JingleSession.terminate method expects reason.name for the element name
        this.jingleSession?.terminate(reason, message, sendIq);
        this.jingleSession = null;
    }

    // --- Source Signaling ---
    addRemoteSources(sources) { // sources is ConferenceSourceMap
        if (this.useSsrcRewriting()) return;
        this.sourceSignaling.addSources(sources);
        if (this.jingleSession?.isActive()) {
            this._scheduleSignalingOfQueuedSources();
        }
    }

    removeRemoteSources(sources) { // sources is ConferenceSourceMap
        if (this.useSsrcRewriting()) return;
        this.sourceSignaling.removeSources(sources);
        if (this.jingleSession?.isActive()) {
            this._scheduleSignalingOfQueuedSources();
        }
    }

    resetSignaledSources(sources) { // sources is ConferenceSourceMap
        return this.sourceSignaling.reset(sources);
    }

    sendQueuedRemoteSources() {
        if (!this.jingleSession?.isActive()) {
            this.logger.warn('Cannot signal remote sources, Jingle session not established or active.');
            return;
        }
        const modifiedSources = this.sourceSignaling.update(); // Expects List<SourcesToAddOrRemove>
        for (const { action, sources } of modifiedSources) { // Assuming structure { action: 'Add'|'Remove', sources: ConferenceSourceMap }
            this.logger.info(`Sending a queued source-${action.toLowerCase()}, sources=${JSON.stringify(sources)}`);
            if (action === 'Add') { // Assuming 'Add'/'Remove' enum/string
                this.jingleSession.addSource(sources);
            } else if (action === 'Remove') {
                this.jingleSession.removeSource(sources);
            }
        }
    }

    _scheduleSignalingOfQueuedSources() {
        // Simplified placeholder for Kotlin's scheduledPool and task management
        // This would typically involve setTimeout and ensuring only one task is scheduled.
        if (this._signalSourcesTimeoutId) {
            // clearTimeout(this._signalSourcesTimeoutId); // Don't clear, let existing one run as per Kotlin logic
            return;
        }
        const delayMs = ConferenceConfig.config.getSourceSignalingDelayMs(this.conference.getParticipantCount());
        this.logger.debug(`Scheduling task to signal queued remote sources after ${delayMs} ms.`);

        this._signalSourcesTimeoutId = setTimeout(() => {
            this.sendQueuedRemoteSources(); // Call without lock, as sendQueuedRemoteSources itself will log/handle session state
            this._signalSourcesTimeoutId = null;
        }, delayMs);
        // Storing the timeout ID on the instance allows for potential cancellation if needed,
        // though the current logic (matching Kotlin) doesn't explicitly cancel if a new schedule is called.
    }


    // --- Invite Runnable Management ---
    /**
     * Sets the current "invite runnable" (e.g., the async operation handling Colibri/Jingle setup).
     * If an existing runnable is present, it's cancelled.
     * @param {object|null} runnable - An object with a `cancel()` method, or null to clear.
     */
    setInviteRunnable(runnable) {
        // Ensure this.inviteRunnableSyncRoot is managed if operations become truly async and re-entrant
        if (this.inviteRunnable && typeof this.inviteRunnable.cancel === 'function') {
            this.logger.warn(`Canceling existing invite runnable for ${this.endpointId}.`);
            try {
                this.inviteRunnable.cancel();
            } catch (e) {
                this.logger.error(`Error cancelling existing invite runnable for ${this.endpointId}:`, e);
            }
        }
        this.inviteRunnable = runnable;
        if (runnable) {
            this.logger.debug(`Invite runnable set for ${this.endpointId}`);
        } else {
            this.logger.debug(`Invite runnable cleared for ${this.endpointId}`);
        }
    }

    /**
     * Called to indicate that the passed invite runnable (or the current one if runnable is null/matches) has completed.
     * @param {object|null} runnable - The runnable that completed. If null, clears current.
     */
    inviteRunnableCompleted(runnable) {
        // Ensure this.inviteRunnableSyncRoot is managed if operations become truly async and re-entrant
        if (this.inviteRunnable === runnable || runnable === undefined /* Allow clearing current by calling with no args */) {
            if (this.inviteRunnable) {
                this.logger.debug(`Invite runnable completed and cleared for ${this.endpointId}`);
                this.inviteRunnable = null;
            }
        } else if (runnable && this.inviteRunnable) {
            // This case (a different runnable completing while one is active) should ideally not happen
            // if setInviteRunnable correctly cancels the previous one.
            this.logger.warn(`A different invite runnable completed for ${this.endpointId} than the one stored. Stored one is kept.`);
        } else if (!this.inviteRunnable && runnable) {
            this.logger.debug(`An invite runnable completed for ${this.endpointId}, but no active runnable was stored.`);
        }
    }


    // --- Other Methods ---
    shouldSuppressForceMute() {
        // Accessing properties directly from chatMember now that it's richer
        return (this.chatMember.isJigasi && !this.hasAudioMuteSupport()) ||
               this.chatMember.isJibri ||
               this.chatMember.role === 'visitor';
    }

    hasModeratorRights() {
        // Logic based on Kotlin's MemberRole.hasModeratorRights()
        const role = this.chatMember.role;
        const affiliation = this.chatMember.affiliation;
        return role === 'moderator' || affiliation === 'owner' || affiliation === 'admin';
    }

    getDebugState(full = false) {
        const state = {
            id: this.endpointId,
            mucJid: this.mucJid,
            role: this.chatMember.role,
            affiliation: this.chatMember.affiliation,
            statsId: this.chatMember.statsId,
            region: this.chatMember.region,
            audioMuted: this.chatMember.audioMuted,
            videoMuted: this.chatMember.videoMuted,
            videoType: this.chatMember.videoType,
            isJibri: this.chatMember.isJibri,
            isJigasi: this.chatMember.isJigasi,
            isTranscriber: this.chatMember.isTranscriber,
            isUserParticipant: this.isUserParticipant,
            features: [...this.supportedFeatures],
            invite_runnable: this.inviteRunnable ? "Running" : "Not running",
            jingle_session: this.jingleSession?.debugState() || null,
        };
        if (full) {
            state.source_signaling = this.sourceSignaling.debugState;
        }
        return state;
    }

    toString() {
        return `Participant[${this.mucJid}]`;
    }

    // --- Inner Jingle Request Handler ---
    _createJingleRequestHandler() {
        // This translates the inner JingleRequestHandlerImpl class
        const self = this; // Capture 'this' for the handler methods

        return {
            _checkJingleSession(jingleSession) {
                if (self.jingleSession !== jingleSession) {
                    return { condition: 'item-not-found', text: 'Jingle session no longer active' }; // StanzaError like
                }
                return null;
            },

            onAddSource(jingleSession, contents) { // contents: Array of ContentPacketExtension like objects
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;

                if (self.chatMember.role === 'visitor') {
                    return { condition: 'forbidden', text: 'add-source not allowed for visitors' };
                }

                let sourcesAdvertised;
                try {
                    sourcesAdvertised = EndpointSourceSet.fromJingle(contents);
                } catch (e) {
                    self.logger.warn(`Failed to parse sources from source-add: ${e.message}`);
                    return { condition: 'bad-request', text: `Malformed sources: ${e.message}` };
                }

                self.logger.debug(`Received source-add from ${self.endpointId}: ${sourcesAdvertised.toString()}`);
                if (sourcesAdvertised.isEmpty()) {
                    self.logger.warn('Received source-add with empty sources, ignoring.');
                    return null; // Acknowledge with empty result
                }
                try {
                    self.conference.participantAddsSources(self, sourcesAdvertised);
                } catch (e) {
                    self.logger.warn(`Rejecting source-add from ${self.endpointId}: ${e.message}`);
                    if (e instanceof SsrcLimitExceededError || e.name === 'SsrcLimitExceededError') {
                        return { condition: 'resource-constraint', text: e.message };
                    } else if (e instanceof ValidationFailedError || e.name === 'ValidationFailedError') { // Catch our custom validation errors
                        return { condition: 'bad-request', text: e.message };
                    }
                    return { condition: 'internal-server-error', text: 'Error processing sources' };
                }
                return null; // Success
            },

            onRemoveSource(jingleSession, contents) {
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;

                let sourcesToRemove;
                try {
                    sourcesToRemove = EndpointSourceSet.fromJingle(contents);
                } catch (e) {
                    self.logger.warn(`Failed to parse sources from source-remove: ${e.message}`);
                    return { condition: 'bad-request', text: `Malformed sources: ${e.message}` };
                }

                if (sourcesToRemove.isEmpty()) {
                    self.logger.info('Ignoring source-remove with no sources specified.');
                    return null;
                }
                self.logger.debug(`Received source-remove from ${self.endpointId}: ${sourcesToRemove.toString()}`);
                try {
                    self.conference.participantRemovesSources(self, sourcesToRemove);
                } catch (e) {
                     self.logger.warn(`Rejecting source-remove from ${self.endpointId}: ${e.message}`);
                     if (e instanceof ValidationFailedError || e.name === 'ValidationFailedError') {
                        return { condition: 'bad-request', text: e.message };
                     }
                     return { condition: 'internal-server-error', text: 'Error processing source removal' };
                }
                return null; // Success
            },

            onSessionAccept(jingleSession, contents) { // contents are the Jingle <content> elements from remote
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;
                self.logger.info(`Received session-accept from ${self.endpointId}`);
                // Participant should parse remote's sources and transport from 'contents'
                // And then call something on self.conference to finalize setup, e.g.,
                // self.conference.participantSessionAccepted(self, parsedRemoteSources, parsedRemoteTransport);
                try {
                    // A session-accept contains the answerer's description and transport.
                    // Each <content> element will have <description> and <transport>.
                    const remoteDetailsByContentName = new Map();
                    let overallRemoteSources = EndpointSourceSet.EMPTY;

                    for (const contentElement of contents) {
                        const contentName = contentElement.attrs.name;
                        let transport = null;
                        const transportElement = contentElement.getChild('transport', jingleUtils.JINGLE_ICE_UDP_TRANSPORT_NS);
                        if (transportElement) {
                            transport = IceUdpTransport.fromXmlElement(transportElement);
                        }

                        // The <description> in a session-accept contains the *answerer's* sources.
                        const sourcesInContent = EndpointSourceSet.fromJingle([contentElement]); // fromJingle expects array of contents
                        overallRemoteSources = overallRemoteSources.add(sourcesInContent);

                        remoteDetailsByContentName.set(contentName, { transport, sources: sourcesInContent });
                    }

                    // Pass all parsed details to the conference for processing.
                    // The conference might primarily care about the transport to update Colibri,
                    // and the overallRemoteSources to update its source map and propagate.
                    self.conference.participantSessionAccepted(self, overallRemoteSources, remoteDetailsByContentName);

                } catch (e) {
                    self.logger.error(`Participant ${self.endpointId}: Error processing session-accept: ${e.message}`);
                    return { condition: 'bad-request', text: `Malformed session-accept: ${e.message}`};
                }
                return null;
            },

            onTransportAccept(jingleSession, contents) {
                // Usually part of session-accept for offerer if transport was in session-initiate.
                // If it's a separate transport-accept, it implies a two-stage transport negotiation.
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;
                self.logger.info(`Received transport-accept from ${self.endpointId}`);
                // TODO: Process transport details if any.
                // self.conference.participantTransportAccepted(self, parsedTransport);
                return null;
            },

            _onSessionOrTransportAccept(jingleSession, contents, action) {
                // This helper was from a previous structure, direct handlers are now used.
                // Kept for reference, but onSessionAccept and onTransportAccept are now distinct.
                self.logger.error('_onSessionOrTransportAccept should not be called directly now.');
                return { condition: 'internal-server-error', text: 'Internal handler error.' };
            },

            onSessionInfo(jingleSession, iq) {
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;

                const iceStateEl = iq.getChildByAttr('xmlns', 'urn:xmpp:jingle:transports:ice-udp:1'); // <ice-udp xmlns=...><ice-state>
                const iceState = iceStateEl?.getChildText('ice-state');

                if (iceState?.toLowerCase() === 'failed') {
                    self.logger.info(`Received ICE failed from ${self.endpointId}`);
                    // ConferenceMetrics.participantsIceFailed.inc(); // Placeholder
                    const bridgeSessionEl = iq.getChild('bridge-session', 'http://jitsi.org/protocol/colibri');
                    const bridgeSessionId = bridgeSessionEl?.attrs.id;
                    // self.conference.iceFailed(self, bridgeSessionId); // TODO: Implement on JitsiMeetConference
                    self.logger.info(`Conference.iceFailed call placeholder for ${self.endpointId}, bsid: ${bridgeSessionId}`);
                } else if (iceState) {
                    self.logger.info(`Received ICE state '${iceState}' from ${self.endpointId}, not processing further.`);
                } else {
                     self.logger.info(`Received session-info from ${self.endpointId} without recognized payload (e.g. ICE failed): ${iq.toString()}`);
                }
                return null;
            },

            onSessionTerminate(jingleSession, iq) { // iq is the full JingleIQ
                const error = this._checkJingleSession(jingleSession);
                // Don't return error if session is already terminated locally, just acknowledge.
                // if (error && self.jingleSession) return error; // If current session is different, it's an error for THAT one.

                const jingleElement = iq.getChild('jingle', 'urn:xmpp:jingle:1');
                const reasonElement = jingleElement?.getChild('reason');
                const reasonCondition = reasonElement?.children[0]?.name; // e.g. 'success', 'connectivity-error'

                const bridgeSessionEl = jingleElement?.getChild('bridge-session', 'http://jitsi.org/protocol/colibri');
                const restartRequested = bridgeSessionEl?.attrs.restart === 'true';
                const bridgeSessionId = bridgeSessionEl?.attrs.id;

                self.logger.info(
                    `Received session-terminate from ${self.endpointId}. SID: ${jingleSession.sid}, Reason: ${reasonCondition}, ` +
                    `Restart: ${restartRequested}, BSID: ${bridgeSessionId}`
                );

                const reinvite = restartRequested && self.acceptRestartRequest();
                try {
                    // self.conference.terminateSession(self, bridgeSessionId, reinvite); // TODO: Implement on JitsiMeetConference
                    // For now, just terminate locally:
                    self.terminateJingleSession({name: reasonCondition || 'general-error'}, "Remote terminated", false);
                    self.logger.info(`Jingle session ${jingleSession.sid} terminated locally due to remote request.`);
                    if (reinvite) {
                        self.logger.info(`Re-invite requested and accepted for ${self.endpointId}. Triggering re-invite process.`);
                        // self.conference.reInviteParticipant(self); // TODO: Needs reInviteParticipant on conference
                    }

                } catch (e) {
                    // if (e.name === 'InvalidBridgeSessionIdException') {
                    //     return { condition: 'item-not-found', text: e.message };
                    // }
                    self.logger.error(`Error processing session-terminate for ${self.endpointId}: ${e.message}`);
                    return { condition: 'internal-server-error', text: 'Error processing session-terminate' };
                }

                if (restartRequested && !reinvite) {
                    self.logger.warn(`Rate limiting restart request for ${self.endpointId}.`);
                    return { condition: 'resource-constraint', text: 'Rate-limited restart' };
                }
                return null; // Acknowledge terminate
            },

            onTransportInfo(jingleSession, contents) { // contents are Jingle <content> elements
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;
                self.logger.info(`Received transport-info from ${self.endpointId}`);

                // transport-info typically contains new candidates.
                // Extract transport element (assuming one content with one transport for simplicity here)
                if (contents.length > 0 && contents[0].getChild('transport', jingleUtils.JINGLE_ICE_UDP_TRANSPORT_NS)) {
                    const transportElement = contents[0].getChild('transport', jingleUtils.JINGLE_ICE_UDP_TRANSPORT_NS);
                    try {
                        const newTransport = IceUdpTransport.fromXmlElement(transportElement);
                        // self.conference.participantTransportInfo(self, newTransport); // TODO: Implement on JitsiMeetConference
                        self.logger.info(`Conference.participantTransportInfo call placeholder for ${self.endpointId}`);
                    } catch (e) {
                        self.logger.warn(`Failed to parse transport from transport-info: ${e.message}`);
                        return { condition: 'bad-request', text: `Malformed transport: ${e.message}` };
                    }
                } else {
                    self.logger.warn('Received transport-info without a recognizable transport element.');
                }
                return null;
            },

            onTransportReject(jingleSession, iq) {
                const error = this._checkJingleSession(jingleSession);
                if (error) return error;
                self.logger.warn(`Received transport-reject from ${self.endpointId}: ${iq.toString()}`);
                return null;
            }
        };
    }
}

module.exports = Participant;
