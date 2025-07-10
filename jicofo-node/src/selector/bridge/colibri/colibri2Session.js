const loggerModule = require('../../../utils/logger');
const {
    buildConferenceModifyIq,
    buildEndpointForMediaAllocation,
    buildEndpointForExpiration,
    buildEndpointForTransportUpdate,
    // buildEndpointForSourcesUpdate, // Not strictly needed if updateParticipant builds dynamically
    COLIBRI2_CONFERENCE_XMLNS
} = require('./colibri2Utils');
const { xml } = require('@xmpp/xml');
// const { ConferenceSourceMap } = require('../../../common/conference/source/conferenceSourceMap');
// const { IceUdpTransportPacketExtension } = require('./colibri2Extensions'); // Placeholder for parsed transport
// const { EndpointSourceSet } = require('../../../common/conference/source/endpointSourceSet');


// Forward declaration for type hinting if ParticipantInfo is complex
// class ParticipantInfo {}


/**
 * Represents a Colibri2 session with a single Jitsi Videobridge.
 * This class is responsible for sending Colibri2 IQs to the bridge and managing
 * the state of the "conference" on that bridge.
 */
class Colibri2Session {
    /**
     * @param {ColibriV2SessionManager} sessionManager - The parent session manager.
     * @param {Bridge} bridge - The bridge instance this session communicates with.
     * @param {boolean} visitor - Whether this session is for visitor components.
     * @param {Logger} parentLogger - Parent logger.
     */
    constructor(sessionManager, bridge, visitor, parentLogger) {
        this.sessionManager = sessionManager;
        this.bridge = bridge;
        this.visitor = visitor;
        this.logger = parentLogger.child({
            component: 'Colibri2Session',
            bridge: this.bridge.getJid()
        });

        this.id = null;
        this.relayId = this.bridge.getRelayId();
        this.feedbackSources = null;
        this.expired = false;

        this.logger.info(`Colibri2Session created for bridge ${this.bridge.getJid()}. Relay ID: ${this.relayId}`);
    }

    /**
     * Sends an allocation request for a new participant (endpoint) to the bridge.
     * @param {ParticipantInfo} participantInfo - Information about the participant.
     * @returns {Promise<Element>} A promise that resolves with the response IQ XML element.
     */
    sendAllocationRequest(participantInfo) {
        this.logger.info(`Sending allocation request for participant ${participantInfo.id} to bridge ${this.bridge.getJid()}`);

        const endpointElement = buildEndpointForMediaAllocation(
            participantInfo.id,
            {
                requestAudio: participantInfo.hasAudioSources(),
                requestVideo: participantInfo.hasVideoSources(),
                requestSctp: participantInfo.useSctp,
                statsId: participantInfo.statsId,
                displayName: participantInfo.displayName,
                initialSources: participantInfo.sources
            }
        );

        const conferenceModifyIq = buildConferenceModifyIq(
            this.bridge.getJid(),
            this.sessionManager.xmppConnection.xmpp.jid.toString(),
            this.sessionManager.meetingId,
            this.sessionManager.conferenceName,
            [endpointElement],
            { create: this.id === null }
        );

        this.logger.debug(`Sending Colibri2 allocation IQ for ${participantInfo.id}: ${conferenceModifyIq.toString()}`);
        return this.sessionManager.xmppConnection.iqCaller.request(conferenceModifyIq);
    }

    /**
     * Updates an existing participant's (endpoint's) parameters on the bridge.
     * @param {ParticipantInfo} participantInfo
     * @param {Element|null} [transportElement=null] - Pre-built <transport> XML element or null.
     * @param {EndpointSourceSet|null} [sources=null] - New sources for the participant or null.
     * @param {object|null} [initialLastN=null] - InitialLastN object or null.
     */
    async updateParticipant(participantInfo, transportElement = null, sources = null, initialLastN = null) {
        this.logger.info(`Updating participant ${participantInfo.id} on bridge ${this.bridge.getJid()}`);
        if (!this.id) {
            this.logger.error(`Cannot update participant ${participantInfo.id}, Colibri conference ID not set for session.`);
            return; // Or throw
        }

        const endpointChildren = [];
        if (transportElement) {
            endpointChildren.push(transportElement);
        }
        if (sources && !sources.isEmpty()) {
            const sourcesElement = sources.toColibriSourcesElement(participantInfo.id);
            if (sourcesElement) endpointChildren.push(sourcesElement);
        }
        // TODO: Handle initialLastN. It's usually an extension to <media> or <endpoint>.
        // For Colibri2, it might be <initial-last-n xmlns='urn:xmpp:colibri2:conference'>N</initial-last-n>
        // as a child of <endpoint>.
        if (initialLastN && initialLastN.value !== undefined) { // Assuming initialLastN = { value: number }
            endpointChildren.push(xml('initial-last-n', { xmlns: COLIBRI2_CONFERENCE_XMLNS }, initialLastN.value.toString()));
        }


        if (endpointChildren.length === 0) {
            this.logger.info(`No actual changes to send for participant ${participantInfo.id} update.`);
            return;
        }

        const endpointElement = xml('endpoint', { id: participantInfo.id }, ...endpointChildren);

        const conferenceModifyIq = buildConferenceModifyIq(
            this.bridge.getJid(),
            this.sessionManager.xmppConnection.xmpp.jid.toString(),
            this.id, // Use existing conference ID
            this.sessionManager.conferenceName,
            [endpointElement],
            { create: false }
        );

        this.logger.debug(`Sending Colibri2 update IQ for ${participantInfo.id}: ${conferenceModifyIq.toString()}`);
        try {
            await this.sessionManager.xmppConnection.sendIq(conferenceModifyIq); // Fire-and-forget for updates (usually)
        } catch (err) {
            this.logger.error(`Error sending update IQ for ${participantInfo.id}:`, err);
            // Notify sessionManager about potential failure?
            this.sessionManager.endpointFailed(this, participantInfo.id);
        }
    }

    /**
     * Updates the force-mute status for a set of participants on this bridge.
     * @param {Set<ParticipantInfo>} participantsToModify - Set of participants whose mute status needs update.
     */
    async updateForceMute(participantsToModify) {
        if (!this.id) {
            this.logger.error('Cannot update force-mute, Colibri conference ID not set.');
            return;
        }
        const endpointElements = [];
        participantsToModify.forEach(pInfo => {
            // Colibri2 <media> element with <force-mute audio="true/false" video="true/false"/>
            const mediaElements = [];
            // Only include media elements if there's a state to set (though bridge might require them)
            // This part needs to align with how JVB expects force-mute updates.
            // Often, one sends <media type="audio" force-mute="true/false"/>
            const audioMedia = xml('media', { type: 'audio', 'force-mute': pInfo.audioMuted.toString() });
            mediaElements.push(audioMedia);
            const videoMedia = xml('media', { type: 'video', 'force-mute': pInfo.videoMuted.toString() });
            mediaElements.push(videoMedia);

            endpointElements.push(xml('endpoint', { id: pInfo.id }, ...mediaElements));
        });

        if (endpointElements.length === 0) {
            this.logger.info('No participants to update force-mute for.');
            return;
        }

        this.logger.info(`Updating force-mute for ${endpointElements.length} participants on bridge ${this.bridge.getJid()}`);
        const conferenceModifyIq = buildConferenceModifyIq(
            this.bridge.getJid(),
            this.sessionManager.xmppConnection.xmpp.jid.toString(),
            this.id,
            this.sessionManager.conferenceName,
            endpointElements,
            { create: false }
        );
        try {
            await this.sessionManager.xmppConnection.sendIq(conferenceModifyIq);
        } catch (err) {
            this.logger.error('Error sending force-mute IQ:', err);
            // Consider if individual endpoint failures here should trigger sessionManager.endpointFailed
        }
    }

    /**
     * Expires specific endpoints or the entire Colibri conference on the bridge.
     * @param {ParticipantInfo[]} [participantsToExpire] - Optional list of participants to expire.
     */
    async expire(participantsToExpire) {
        if (this.expired && (!participantsToExpire || participantsToExpire.length === 0) ) {
             this.logger.warn(`Entire conference ${this.id} on bridge ${this.bridge.getJid()} already marked as expired.`);
             return;
        }
        // If no ID, we can't expire specific endpoints. If trying to expire whole conference, ID is needed.
        if (!this.id && participantsToExpire && participantsToExpire.length > 0) {
             this.logger.warn(`Cannot expire specific endpoints on bridge ${this.bridge.getJid()}, no Colibri conference ID set. Session might not have been established.`);
             return;
        }
        if (!this.id && (!participantsToExpire || participantsToExpire.length === 0)) {
            this.logger.warn(`Cannot expire entire conference on bridge ${this.bridge.getJid()}, no Colibri conference ID set. Marking as locally expired.`);
            this.expired = true;
            // No IQ to send if we don't have a conference ID on the bridge.
            this.sessionManager.sessionFailed(this); // Notify manager this session is unusable
            return;
        }

        let endpointElements = [];
        let conferenceOptions = { create: false };

        if (participantsToExpire && participantsToExpire.length > 0) {
            const endpointIds = participantsToExpire.map(p => p.id).join(', ');
            this.logger.info(`Expiring specific endpoints (${endpointIds}) on bridge ${this.bridge.getJid()} for conference ${this.id}`);
            participantsToExpire.forEach(pInfo => {
                if (pInfo.session === this) { // Ensure participant belongs to this session
                    endpointElements.push(buildEndpointForExpiration(pInfo.id));
                } else {
                    this.logger.warn(`Participant ${pInfo.id} to expire is not on this session ${this.id}. Ignoring.`);
                }
            });
            if (endpointElements.length === 0) {
                this.logger.info('No valid endpoints to expire from the provided list for this session.');
                return;
            }
        } else { // Expire whole conference on this bridge
            this.logger.info(`Expiring entire Colibri conference ${this.id} on bridge ${this.bridge.getJid()}`);
            this.expired = true;
            conferenceOptions.expire = true;
        }

        const conferenceModifyIq = buildConferenceModifyIq(
            this.bridge.getJid(),
            this.sessionManager.xmppConnection.xmpp.jid.toString(),
            this.id,
            this.sessionManager.conferenceName,
            endpointElements,
            conferenceOptions
        );

        this.logger.debug(`Sending Colibri2 expire IQ: ${conferenceModifyIq.toString()}`);
        try {
            await this.sessionManager.xmppConnection.sendIq(conferenceModifyIq);
        } catch (err) {
            this.logger.error(`Error sending expire IQ for conference ${this.id}:`, err);
        }

        if (this.expired) { // If the whole session was marked to expire
            this.sessionManager.sessionFailed(this);
        }
    }

    // --- Octo/Relay specific methods ---

    createRelay(remoteRelayId, remoteParticipants, initiator, meshId) {
        this.logger.info(`Creating Octo relay from ${this.relayId} to ${remoteRelayId} for mesh ${meshId}`);
        // TODO: Construct and send Colibri2 IQ to create a relay (e.g., <relay create ...>)
    }

    expireRelay(remoteRelayId) {
        this.logger.info(`Expiring Octo relay from ${this.relayId} to ${remoteRelayId}`);
        // TODO: Construct and send Colibri2 IQ to expire a relay (e.g., <relay expire ...>)
    }

    updateRemoteParticipant(remoteParticipantInfo, sourceBridgeRelayId, create) {
        this.logger.info(`${create ? 'Creating' : 'Updating'} remote participant view for ${remoteParticipantInfo.id} from bridge ${sourceBridgeRelayId}`);
        // TODO: Construct and send Colibri2 IQ
    }

    setRelayTransport(transport, sourceBridgeRelayId) {
        this.logger.info(`Setting relay transport from bridge ${sourceBridgeRelayId} for local relay to it.`);
        // TODO: Construct and send Colibri2 IQ
    }

    expireRemoteParticipants(remoteParticipantsToExpire, sourceBridgeRelayId) {
        const endpointIds = remoteParticipantsToExpire.map(p => p.id).join(', ');
        this.logger.info(`Expiring remote participants (${endpointIds}) from bridge ${sourceBridgeRelayId}`);
        // TODO: Construct and send Colibri2 IQ
    }


    toJson() {
        return {
            id: this.id,
            bridge: this.bridge.getJid()?.toString(),
            relayId: this.relayId,
            visitor: this.visitor,
            expired: this.expired,
            feedbackSources: this.feedbackSources?.toJson()
        };
    }
}

module.exports = Colibri2Session;
