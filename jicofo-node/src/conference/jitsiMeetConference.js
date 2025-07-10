const loggerModule = require('../utils/logger');
const { JidUtils } = require('../config/serviceConfigs');
const EventEmitter = require('events');
const { ChatRoom, ChatRoomMember } = require('../xmpp/muc/chatRoom');
const Participant = require('./participant');
const MediaType = require('../common/conference/source/mediaType');
const jingleUtils = require('../common/xmpp/jingle/jingleUtils');
const EndpointSourceSet = require('../common/conference/source/endpointSourceSet');
const {
    ValidatingConferenceSourceMap,
    ValidationFailedError,
    SsrcLimitExceededError /* Import other specific error types if needed */
} = require('../common/conference/source/validatingConferenceSourceMap');
const { xml } = require('@xmpp/xml');
const { IceUdpTransport } = require('../common/xmpp/jingle/iceUdpTransport'); // For type checking if needed

// This class gets per-conference properties (e.g. from MUC config form, or API)
// and falls back to global config for defaults.
class JitsiMeetConfig {
    constructor(properties, jicofoSrv) {
        this.properties = properties || {};
        this.jicofoSrv = jicofoSrv;

        const getProp = (key, globalConfigPath, defaultValue, isBoolean = false) => {
            if (this.properties.hasOwnProperty(key)) {
                const val = this.properties[key];
                if (isBoolean) return val === 'true';
                const numVal = parseInt(val, 10);
                return isNaN(numVal) ? defaultValue : val; // Return original string if not parsable as int, unless bool
            }
            return this.jicofoSrv.jicofoConfig.getOptionalConfig(globalConfigPath, defaultValue);
        };

        this.startAudioMuted = getProp('startAudioMuted', 'conference.startAudioMuted', 0);
        this.startVideoMuted = getProp('startVideoMuted', 'conference.startVideoMuted', 0);
        this.rtcStatsEnabled = getProp('rtcStatsEnabled', 'conference.rtcStatsEnabled', false, true);
        // Example: this.minParticipants = getProp('minParticipants', 'conference.minParticipants', 2);
    }

    getDebugState() {
        return { properties: this.properties };
    }
}


class JitsiMeetConference extends EventEmitter {
    constructor(
        roomName,
        listener,
        properties,
        logLevel = 'INFO',
        jvbVersion, // Pinned JVB version
        includeInStatistics,
        jicofoServices
    ) {
        super();
        this.roomName = roomName;
        this.listener = listener;
        this.jvbVersion = jvbVersion;
        this.includeInStatistics = includeInStatistics;
        this.jicofoSrv = jicofoServices;

        this.logger = loggerModule.child({ conference: this.roomName.toString() });
        this.logger.level = logLevel.toLowerCase() || 'info';

        this.config = new JitsiMeetConfig(properties, this.jicofoSrv);

        this.started = false;
        this.meetingId = null;
        this.mainRoomJid = null;

        this.participants = new Map(); // MUC JID (full) -> Participant object

        const maxSsrcs = this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.maxSsrcsPerUser', 20);
        const maxGroups = this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.maxSsrcGroupsPerUser', 20);
        this.conferenceSources = new ValidatingConferenceSourceMap(maxSsrcs, maxGroups);

        this.conferenceProperties = new Map();

        this.singleParticipantTimeoutId = null;
        this.conferenceStartTimeoutId = null;
        this.reconnectTimeoutId = null;

        this.chatRoom = null;
        this.focusUserNickname = this.jicofoSrv.jicofoConfig.getOptionalConfig('focusUser.nickname', 'Focus');

        this.logger.info(`Created new conference. Pinned JVB version: ${jvbVersion || 'any'}`);
        this._rescheduleConferenceStartTimeout();
    }

    _rescheduleConferenceStartTimeout() {
        this.clearConferenceStartTimeout();
        const timeoutMs = this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.conferenceStartTimeoutMs', 30000);

        this.conferenceStartTimeoutId = setTimeout(() => {
            this.logger.info(`Expiring due to initial conference start timeout (${timeoutMs}ms).`);
            if (this.jicofoSrv.focusManager.hasBreakoutRooms(this.roomName)) {
                 this.logger.info("Breakout rooms still present, will not stop due to start timeout.");
                 return;
            }
            this.stop();
        }, timeoutMs);
        this.logger.info(`Scheduled conference start timeout: ${timeoutMs}ms.`);
    }

    clearConferenceStartTimeout() {
        if (this.conferenceStartTimeoutId) {
            clearTimeout(this.conferenceStartTimeoutId);
            this.conferenceStartTimeoutId = null;
            this.logger.debug('Cleared conference start timeout.');
        }
    }

    async start() {
        if (this.started) {
            this.logger.warn('Conference already started.');
            return;
        }
        this.logger.info('Starting conference...');
        try {
            const xmppConnection = this.jicofoSrv.xmppServices.clientConnection;
            if (!xmppConnection || !xmppConnection.isRegistered) {
                this.logger.error('Cannot start conference, XMPP client not registered.');
                throw new Error('XMPP client not registered.');
            }

            this.chatRoom = new ChatRoom(
                this.roomName,
                xmppConnection,
                this.focusUserNickname,
                this.logger
            );

            const chatRoomInfo = await this.chatRoom.join();
            this.meetingId = chatRoomInfo.meetingId;
            this.mainRoomJid = chatRoomInfo.mainRoomJid;
            this.logger.addContext({ meeting_id: this.meetingId });
            this.logger.info(`MUC ${this.roomName} joined. Meeting ID: ${this.meetingId}. Main Room JID: ${this.mainRoomJid}`);

            this._setupChatRoomListeners();

            this.started = true;
            this.logger.info('Conference started successfully.');
            this.clearConferenceStartTimeout();

        } catch (error) {
            this.logger.error('Failed to start conference:', error);
            await this.stop();
            throw error;
        }
    }

    async stop() {
        // ... (stop logic as before, ensure all participants are terminated)
        if (!this.started && !this.conferenceStartTimeoutId) {
            this.logger.info('Conference stop called but was not fully started or already stopped.');
            this.clearConferenceStartTimeout();
            return;
        }
        this.logger.info('Stopping conference...');
        this.started = false;

        this.clearConferenceStartTimeout();
        // TODO: Clear other timeouts (singleParticipantTimeoutId, reconnectTimeoutId)

        this.participants.forEach(p => this._terminateParticipant(p, 'conference-terminated', 'Conference shut down', true /* send session-terminate if Jicofo is ending it */));

        // TODO: Shutdown Jibri services
        // TODO: Expire Colibri session on the bridge
        // this.jicofoSrv.colibriSessionManager.expireConference(this.meetingId);

        if (this.chatRoom) {
            try {
                await this.chatRoom.leave();
            } catch (e) {
                this.logger.error('Error leaving MUC room:', e);
            }
            this._removeChatRoomListeners();
            this.chatRoom = null;
        }

        this.logger.info('Conference stopped.');
        if (this.listener && typeof this.listener.conferenceEnded === 'function') {
            this.listener.conferenceEnded(this);
        }
        this.emit('ended');
    }

    getRoomName() { return this.roomName; }
    isStarted() { return this.started; }
    getParticipantCount() { return this.participants.size; }
    getMeetingId() { return this.meetingId; }
    getMainRoomJid() { return this.mainRoomJid; }
    includeInStatistics() { return this.includeInStatistics; }

    getSourcesForParticipant(participantOrEndpointId) {
        const endpointId = typeof participantOrEndpointId === 'string'
            ? participantOrEndpointId
            : participantOrEndpointId?.endpointId;

        if (!endpointId) return EndpointSourceSet.EMPTY;
        return this.conferenceSources.get(endpointId) || EndpointSourceSet.EMPTY;
    }

    getAllConferenceSources() {
        return this.conferenceSources.copy();
    }

    _setupChatRoomListeners() {
        if (!this.chatRoom) return;
        this.chatRoom.on('memberJoined', this._handleMucMemberJoined.bind(this));
        this.chatRoom.on('memberLeft', this._handleMucMemberLeft.bind(this));
        this.chatRoom.on('memberPresenceChanged', this._handleMucMemberPresenceChanged.bind(this));
        this.chatRoom.on('selfPresenceReceived', this._handleMucSelfPresenceReceived.bind(this));
    }

    _removeChatRoomListeners() {
        if (!this.chatRoom) return;
        this.chatRoom.removeAllListeners(); // Remove all listeners for this ChatRoom instance
    }

    _handleMucMemberJoined(chatRoomMember, presenceStanza) {
        this.logger.info(`MUC Member Joined: ${chatRoomMember.getName()} (${chatRoomMember.getOccupantJid()})`);
        if (this.participants.has(chatRoomMember.getOccupantJid())) {
            this.logger.warn(`Participant ${chatRoomMember.getName()} already exists. Ignoring join event.`);
            return;
        }
        // TODO: Full onMemberJoined logic (min participants, timeouts, etc.)
        // For now, directly invite if conference is started
        if (this.isStarted()) {
            this._inviteChatMember(chatRoomMember, true /* justJoined */);
        } else {
            this.logger.info(`Conference not fully started, deferring invite for ${chatRoomMember.getName()}`);
            // Could queue them or wait for conference 'start' event if that's a thing.
        }
    }

    _inviteChatMember(chatRoomMember, justJoined) {
        if (this.participants.has(chatRoomMember.getOccupantJid())) {
            this.logger.debug(`Participant ${chatRoomMember.getName()} already invited/present.`);
            return;
        }
        this.logger.info(`Creating and inviting participant ${chatRoomMember.getName()}`);
        const participant = new Participant(
            chatRoomMember,
            this,
            this.jicofoSrv.xmppServices.jingleHandler,
            this.logger,
            chatRoomMember.features
        );
        this.participants.set(chatRoomMember.getOccupantJid(), participant);
        this.logger.info(`Participant ${participant.endpointId} added. Count: ${this.participants.size}`);

        const inviteTask = this._initiateParticipantSession(participant, false /* isReinvite */, justJoined);
        participant.setInviteRunnable({
            cancel: () => {
                this.logger.info(`Invite for ${participant.endpointId} cancelled (conceptual).`);
                if (participant.jingleSession) {
                    this._terminateParticipant(participant, 'cancelled', 'Invitation cancelled', true);
                } else {
                     this.logger.info(`Removing participant ${participant.endpointId} before Jingle started due to cancel.`);
                     this.participants.delete(participant.mucJid);
                     this.conferenceSources.remove(participant.endpointId);
                }
            }
        });
        inviteTask.catch(err => {
            this.logger.warn(`_inviteChatMember: _initiateParticipantSession eventually failed for ${participant.endpointId}: ${err.message}`);
            if (this.participants.has(participant.mucJid)) { // Check if not already terminated by _initiateParticipantSession's own catch
                 this._terminateParticipant(participant, 'error', `Session initiation failed: ${err.message}`, true);
            }
        });
    }

    _handleMucMemberLeft(chatRoomMember, presenceStanza) {
        this.logger.info(`MUC Member Left: ${chatRoomMember.getName()} (${chatRoomMember.getOccupantJid()})`);
        const participant = this.participants.get(chatRoomMember.getOccupantJid());
        if (participant) {
            // true to send session-terminate as Jicofo is reacting to MUC leave
            this._terminateParticipant(participant, 'gone', "Member left MUC", true);
        } else {
            this.logger.warn(`Participant ${chatRoomMember.getName()} not found upon MUC left event.`);
        }
        // TODO: Check for last participant, breakout rooms, etc. to stop conference (maybeStop logic from Java)
    }

    _terminateParticipant(participant, reasonCode, reasonMessage, sendSessionTerminate = false) {
        this.logger.info(`Terminating participant ${participant.endpointId}: reason=${reasonCode}, msg=${reasonMessage}`);

        // JingleSession.terminate expects a reason object { name: 'reason-string' }
        participant.terminateJingleSession({ name: reasonCode }, reasonMessage, sendSessionTerminate);

        this.conferenceSources.remove(participant.endpointId);
        this.logger.info(`Removed sources for ${participant.endpointId} from conference map.`);

        // Update Colibri on the bridge to expire endpoints for this participant
        const colibriSessionManager = this.jicofoSrv.colibriSessionManager;
        if (colibriSessionManager) {
            this.logger.info(`Requesting Colibri endpoint expiration for ${participant.endpointId}`);
            colibriSessionManager.removeParticipant(participant.endpointId);
            // This call is async fire-and-forget in nature, errors handled within CSM.
        } else {
            this.logger.warn('ColibriSessionManager not available, cannot expire Colibri endpoint.');
        }


        const mucJid = participant.mucJid; // Get before clearing participant
        this.participants.delete(mucJid);
        this.logger.info(`Participant ${participant.endpointId} removed. Count: ${this.participants.size}`);

        participant.inviteRunnableCompleted();
    }

    _handleMucMemberPresenceChanged(chatRoomMember, presenceStanza) {
        this.logger.debug(`MUC Member Presence Changed: ${chatRoomMember.getName()}`);
        const participant = this.participants.get(chatRoomMember.getOccupantJid());
        if (participant) {
            // participant.chatMember can be updated if ChatRoomMember objects are reused by ChatRoom,
            // or pass the new chatRoomMember state to participant.updateState(newChatRoomMemberState)
            this.logger.debug('TODO: Process participant presence change details.');
        }
    }

    _handleMucSelfPresenceReceived(presenceStanza) {
        this.logger.info('Self-presence in MUC received.');
        // TODO: Send initial conference properties in presence via this.chatRoom.updatePresenceExtensions(...)
        // E.g. this.setConferenceProperty('bridge_count', this.jicofoSrv.colibriSessionManager.bridgeCount.toString());
    }

    participantAddsSources(participant, sourcesToAdd) {
        this.logger.info(`Participant ${participant.endpointId} trying to add sources: ${sourcesToAdd.toString()}`);
        try {
            const acceptedSources = this.conferenceSources.tryToAdd(participant.endpointId, sourcesToAdd);
            if (!acceptedSources.isEmpty()) {
                this.logger.info(`Accepted sources for ${participant.endpointId}: ${acceptedSources.toString()}`);
                const fullSourceSetForParticipant = this.getSourcesForParticipant(participant);
                participant.setSources(fullSourceSetForParticipant); // Update participant's view of its own sources

                // 1. Update Colibri on the bridge for this participant (send new sources)
                this.jicofoSrv.colibriSessionManager.updateParticipant(
                    participant.endpointId,
                    null, /* no transport change */
                    fullSourceSetForParticipant, /* new full source set */
                    null  /* no lastN change */
                );

                // 2. Propagate acceptedSources to other participants via Jingle source-add
                this._propagateSourcesToOthers(participant, acceptedSources, 'add');
            }
            return acceptedSources;
        } catch (e) {
            if (e instanceof ValidationFailedError) {
                this.logger.warn(`Source validation failed for ${participant.endpointId} adding sources: ${e.message}`);
            } else {
                this.logger.error(`Error adding sources for ${participant.endpointId}:`, e);
            }
            throw e;
        }
    }

    participantRemovesSources(participant, sourcesToRemove) {
        this.logger.info(`Participant ${participant.endpointId} trying to remove sources: ${sourcesToRemove.toString()}`);
        try {
            const removedSources = this.conferenceSources.tryToRemove(participant.endpointId, sourcesToRemove);
            if (!removedSources.isEmpty()) {
                this.logger.info(`Actually removed sources for ${participant.endpointId}: ${removedSources.toString()}`);
                // 1. Update Colibri on the bridge
                const fullSourceSetForParticipant = this.getSourcesForParticipant(participant);
                this.jicofoSrv.colibriSessionManager.updateParticipant(
                    participant.endpointId,
                    null,
                    fullSourceSetForParticipant,
                    null
                );

                // 2. Propagate removedSources to other participants via Jingle source-remove
                this._propagateSourcesToOthers(participant, removedSources, 'remove');
            }
            return removedSources;
        } catch (e) {
            if (e instanceof ValidationFailedError) {
                this.logger.warn(`Source validation failed for ${participant.endpointId} removing sources: ${e.message}`);
            } else {
                this.logger.error(`Error removing sources for ${participant.endpointId}:`, e);
            }
            throw e;
        }
    }

    participantSessionAccepted(participant, remoteSources) {
        this.logger.info(`Jingle session-accept received from ${participant.endpointId}. Remote sources: ${remoteSources.toString()}`);

        if (remoteSources && !remoteSources.isEmpty()) {
            this.logger.info(`Processing sources from ${participant.endpointId}'s session-accept.`);
            try {
                const acceptedByConference = this.conferenceSources.tryToAdd(participant.endpointId, remoteSources);
                this.logger.info(`Accepted sources from ${participant.endpointId} (on session-accept): ${acceptedByConference.toString()}`);
                const fullSourceSetForParticipant = this.getSourcesForParticipant(participant);
                participant.setSources(fullSourceSetForParticipant); // Update participant's view

                if (!acceptedByConference.isEmpty()) { // Only propagate if something new was accepted
                    // Propagate these newly accepted sources to other participants.
                    this._propagateSourcesToOthers(participant, acceptedByConference, 'add');
                }

                // Update Colibri with these sources if JVB needs to know about them now.
                this.jicofoSrv.colibriSessionManager.updateParticipant(
                    participant.endpointId,
                    null,
                    fullSourceSetForParticipant, // Send the full current set
                    null
                );

            } catch (e) {
                this.logger.warn(`Validation failed for sources from ${participant.endpointId} in session-accept: ${e.message}`);
            }
        }

        participant.sendQueuedRemoteSources();
        this.logger.info(`Jingle session active for ${participant.endpointId}.`);
    }

    participantTransportInfo(participant, newTransport) {
        this.logger.info(`Received Jingle transport-info from ${participant.endpointId}`);
        if (newTransport instanceof IceUdpTransport) {
            this.logger.info(`Updating Colibri transport for ${participant.endpointId}.`);
            const transportXmlElement = newTransport.toXmlElement();
            // Pass participant's current full source set when updating transport,
            // as Colibri might expect sources if transport is updated.
            // Or, if only transport is changing, sources could be null.
            // Jicofo Java's Participant.updateTransport sends null for sources.
            this.jicofoSrv.colibriSessionManager.updateParticipant(
                participant.endpointId,
                transportXmlElement,
                null, // Typically, transport-info doesn't re-send all sources.
                null
            );
        } else {
            this.logger.warn(`Received transport-info from ${participant.endpointId} but newTransport is not an IceUdpTransport instance.`);
        }
    }

    iceFailed(participant, bridgeSessionId) {
        this.logger.warn(`ICE failed for participant ${participant.endpointId}. Bridge session: ${bridgeSessionId}`);
        // ConferenceMetrics.participantsIceFailed.inc(); // Placeholder

        const currentBridgeSessionId = this.jicofoSrv.colibriSessionManager.getBridgeSessionId(participant.endpointId);
        if (bridgeSessionId && currentBridgeSessionId && bridgeSessionId !== currentBridgeSessionId) {
            this.logger.info(
                `Ignoring ICE failed for ${participant.endpointId} with old bridge session ID ${bridgeSessionId} ` +
                `(current is ${currentBridgeSessionId}).`
            );
            return;
        }

        this.logger.info(`Re-inviting participant ${participant.endpointId} due to ICE failure.`);
        participant.setInviteRunnable(null);
        this._initiateParticipantSession(participant, true /* isReinvite */, false /* not justJoined MUC */)
            .catch(err => this.logger.error(`Re-invite after ICE failed for ${participant.endpointId} also failed: ${err.message}`));
    }

    participantRequestsTerminate(participant, bridgeSessionId, acceptedReinviteRequest) {
        this.logger.info(
            `Participant ${participant.endpointId} sent session-terminate. Bridge session: ${bridgeSessionId}, ` +
            `Re-invite accepted by rate limit: ${acceptedReinviteRequest}`
        );

        const currentBridgeSessionId = this.jicofoSrv.colibriSessionManager.getBridgeSessionId(participant.endpointId);
        if (bridgeSessionId && currentBridgeSessionId && bridgeSessionId !== currentBridgeSessionId) {
             this.logger.info(
                `Ignoring session-terminate for ${participant.endpointId} with old bridge session ID ${bridgeSessionId} ` +
                `(current is ${currentBridgeSessionId}). Still terminating local Jingle session.`
            );
            participant.terminateJingleSession({ name: 'connectivity-error' }, 'Stale bridge session ID', false);
            return;
        }

        // Terminate current Jingle session and Colibri resources.
        // The 'false' for sendSessionTerminate is because the remote peer already sent it.
        this._terminateParticipant(participant, 'success', 'Terminated by remote', false);

        if (acceptedReinviteRequest) {
            this.logger.info(`Re-inviting participant ${participant.endpointId} as requested.`);
            participant.setInviteRunnable(null);
            this._initiateParticipantSession(participant, true /* isReinvite */, false)
                .catch(err => this.logger.error(`Re-invite for ${participant.endpointId} failed: ${err.message}`));
        }
    }


    _hasToStartAudioMuted(justJoined, participant) {
        // In Java, getParticipantCount() was used *before* adding the new participant.
        // Here, participant is already in this.participants map when this is called from _inviteChatMember -> _initiateParticipantSession
        // So, current this.getParticipantCount() includes the one being invited.
        const currentCountForEval = this.getParticipantCount() - (justJoined ? 1:0); // Effective count *before* this one fully joins for this rule

        if (this.config.startAudioMuted > 0 && justJoined && currentCountForEval >= this.config.startAudioMuted) {
            return true;
        }
        const audioSenderLimit = this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.maxAudioSenders', 10);
        return currentCountForEval >= audioSenderLimit; // If count is already AT limit, next one is muted
    }

    _hasToStartVideoMuted(justJoined, participant) {
        const currentCountForEval = this.getParticipantCount() - (justJoined ? 1:0);
        if (this.config.startVideoMuted > 0 && justJoined && currentCountForEval >= this.config.startVideoMuted) {
            return true;
        }
        const videoSenderLimit = this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.maxVideoSenders', 10);
        return currentCountForEval >= videoSenderLimit;
    }


    async _initiateParticipantSession(participant, isReinvite, justJoined) {
        this.logger.info(`Initiating session for participant ${participant.endpointId}. Reinvite: ${isReinvite}, JustJoined: ${justJoined}`);
        try {
            const allocationParams = {
                id: participant.endpointId,
                statsId: participant.statId,
                displayName: participant.chatMember.nick,
                visitor: participant.chatMember.role === 'visitor',
                useSctp: participant.hasSctpSupport() && this.jicofoSrv.jicofoConfig.getOptionalConfig('conference.enableSctp', true),
                sources: participant.sources,
                region: participant.chatMember.region,
                startAudioMuted: this._hasToStartAudioMuted(justJoined, participant),
                startVideoMuted: this._hasToStartVideoMuted(justJoined, participant),
                requestAudio: participant.hasAudioSupport(),
                requestVideo: participant.hasVideoSupport(),
            };
            this.logger.debug(`Colibri allocation params for ${participant.endpointId}:`,
                {...allocationParams, sources: allocationParams.sources?.sources.size + ' sources'}
            );

            const colibriAllocation = await this.jicofoSrv.colibriSessionManager.allocate(allocationParams);
            this.logger.info(`Colibri allocation successful for ${participant.endpointId}. Bridge session ID: ${colibriAllocation.bridgeSessionId}`);
            // participant.setColibriConferenceId(colibriAllocation.bridgeSessionId); // Store on participant

            const jingleContents = [];
            const contentNamesForBundle = [];
            const self = this;
            const createMediaContent = (mediaType) => {
                const content = xml('content', { creator: 'initiator', name: mediaType, senders: 'both' });
                const rtpDescription = xml('description', { xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: mediaType });
                const codecConfigPath = `jingle.codecs.${mediaType}`;
                const hdrextConfigPath = `jingle.rtpHdrExts.${mediaType}`;
                const codecList = self.jicofoSrv.jicofoConfig.getOptionalConfig(codecConfigPath, []);
                const hdrextList = self.jicofoSrv.jicofoConfig.getOptionalConfig(hdrextConfigPath, []);
                jingleUtils.createPayloadTypeElements(codecList).forEach(pt => rtpDescription.append(pt.clone()));
                jingleUtils.createRtpHdrExtElements(hdrextList).forEach(ext => rtpDescription.append(ext.clone()));

                // Add Jitsi-specific initial-last-n extension
                const lastNConfigPath = `jingle.initialLastN.${mediaType}`;
                const lastNValue = self.jicofoSrv.jicofoConfig.getOptionalConfig(lastNConfigPath, -1);
                if (lastNValue > -2) { // -1 is common for "send all", -2 might mean "don't include"
                    const initialLastNEl = xml('initial-last-n', { xmlns: `http://jitsi.org/jitmeet/${mediaType}` }, lastNValue.toString());
                    rtpDescription.append(initialLastNEl);
                }

                content.append(rtpDescription);
                if (colibriAllocation.endpointTransport) {
                    content.append(colibriAllocation.endpointTransport.toXmlElement());
                } else {
                    self.logger.error(`No transport in Colibri for ${participant.endpointId}, media ${mediaType}`);
                    return null;
                }
                return content;
            };

            if (allocationParams.requestAudio) {
                const audioContent = createMediaContent(MediaType.AUDIO);
                if (audioContent) {
                    jingleContents.push(audioContent);
                    contentNamesForBundle.push(MediaType.AUDIO);
                }
            }
            if (allocationParams.requestVideo) {
                const videoContent = createMediaContent(MediaType.VIDEO);
                if (videoContent) {
                    jingleContents.push(videoContent);
                    contentNamesForBundle.push(MediaType.VIDEO);
                }
            }

            if (allocationParams.useSctp && colibriAllocation.endpointSctpPort) {
                self.logger.info(`Adding SCTP data channel to Jingle offer, port ${colibriAllocation.endpointSctpPort}`);
                const dataContent = xml('content', { creator: 'initiator', name: 'data', senders: 'both' });
                const dataApplicationDesc = xml('description', { xmlns: 'urn:xmpp:jingle:apps:webrtc-datachannel:0' });
                if (jingleContents.length > 0) {
                    const firstMediaContent = jingleContents[0];
                    const transportElement = firstMediaContent.getChild('transport', jingleUtils.JINGLE_ICE_UDP_TRANSPORT_NS);
                    if (transportElement) {
                        transportElement.append(
                            xml('sctp-port', {
                                xmlns: 'urn:xmpp:jingle:transports:dtls-sctp:1',
                                value: colibriAllocation.endpointSctpPort.toString()
                            })
                        );
                         dataContent.append(dataApplicationDesc);
                         jingleContents.push(dataContent);
                         contentNamesForBundle.push('data');
                    } else {
                        self.logger.warn(`No transport found in first media content to attach SCTP port for ${participant.endpointId}.`);
                    }
                } else {
                     self.logger.warn(`No media content found to attach SCTP port for ${participant.endpointId}. Data channel not offered.`);
                }
            }

            if (jingleContents.length === 0) {
                self.logger.error(`No Jingle content to send for ${participant.endpointId} after Colibri allocation.`);
                throw new Error('No Jingle content to send.');
            }

            const jingleSession = participant.createNewJingleSession();
            const additionalJingleExtensions = [];
            if (contentNamesForBundle.length > 1) {
                const bundleExt = jingleUtils.createBundleGroupExtension(jingleContents);
                if (bundleExt) additionalJingleExtensions.push(bundleExt);
            }

            // sourcesForOffer should be a ConferenceSourceMap.
            // endpointFeedbackSources is an EndpointSourceSet.
            // We wrap it in a ConferenceSourceMap, attributing these feedback sources to the participant itself from Jicofo's perspective.
            const feedbackSources = colibriAllocation.endpointFeedbackSources || EndpointSourceSet.EMPTY;
            const sourcesForOffer = feedbackSources.isEmpty()
                ? null // Pass null if no feedback sources, JingleSession handles null sourcesMap
                : ConferenceSourceMap.fromOwnerAndSet(participant.endpointId, feedbackSources);

            this.logger.info(`Initiating Jingle session for ${participant.endpointId} with ${jingleContents.length} contents.`);
            const jingleSuccess = await jingleSession.initiateSession(
                jingleContents,
                additionalJingleExtensions,
                sourcesForOffer
            );

            if (jingleSuccess) {
                this.logger.info(`Jingle session-initiate sent successfully for ${participant.endpointId}.`);
                participant.inviteRunnableCompleted(this);
            } else {
                this.logger.error(`Jingle session-initiate failed for ${participant.endpointId}.`);
                throw new Error('Jingle session initiation failed.');
            }

        } catch (error) {
            this.logger.error(`Failed to initiate session for participant ${participant.endpointId}:`, error);
            // Ensure participant is terminated if already added to map
            if (this.participants.has(participant.mucJid)) {
                 this._terminateParticipant(participant, 'error', `Session initiation failed: ${error.message}`, true);
            }
            participant.inviteRunnableCompleted(this);
        }
    }
}

module.exports = JitsiMeetConference;
