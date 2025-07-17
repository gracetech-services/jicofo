const config = require('config');

class ConferenceConfig {
    constructor() {
        // Load configuration from config files
        this.conferenceStartTimeout = config.get('jicofo.conference.initial-timeout', 30000); // 30 seconds default
        this.enableAutoOwner = config.get('jicofo.conference.enable-auto-owner', true);
        this.enableModeratorChecks = config.get('jicofo.conference.enable-moderator-checks', true);
        this.maxSsrcsPerUser = config.get('jicofo.conference.max-ssrcs-per-user', 10);
        this.maxSsrcGroupsPerUser = config.get('jicofo.conference.max-ssrc-groups-per-user', 5);
        this.singleParticipantTimeout = config.get('jicofo.conference.single-participant-timeout', 30000); // 30 seconds
        this.minParticipants = config.get('jicofo.conference.min-participants', 1);
        this.maxAudioSenders = config.get('jicofo.conference.max-audio-senders', 10);
        this.maxVideoSenders = config.get('jicofo.conference.max-video-senders', 10);
        this.useSsrcRewriting = config.get('jicofo.conference.use-ssrc-rewriting', true);
        this.useJsonEncodedSources = config.get('jicofo.conference.use-json-encoded-sources', true);
        this.useRandomSharedDocumentName = config.get('jicofo.conference.shared-document.use-random-name', true);
        this.restartRequestMinInterval = config.get('jicofo.conference.restart-request-rate-limits.min-interval', 1000); // 1 second
        this.restartRequestMaxRequests = config.get('jicofo.conference.restart-request-rate-limits.max-requests', 3);
        this.restartRequestInterval = config.get('jicofo.conference.restart-request-rate-limits.interval', 60000); // 1 minute
        this.reinviteMethod = config.get('jicofo.conference.reinvite-method', 'NONE');
        this.stripSimulcast = config.get('jicofo.conference.strip-simulcast', false);

        // Source signaling delays - map of conference size to delay in milliseconds
        this.sourceSignalingDelays = config.get('jicofo.conference.source-signaling-delays', {
            1: 0,
            5: 100,
            10: 200,
            20: 500,
            50: 1000
        });
    }

    /**
     * Get the number of milliseconds to delay signaling of Jingle sources given a certain conference size.
     * @param {number} conferenceSize - The size of the conference
     * @returns {number} - The delay in milliseconds
     */
    getSourceSignalingDelayMs(conferenceSize) {
        // Find the largest conference size that is <= the given size
        const sizes = Object.keys(this.sourceSignalingDelays).map(Number).sort((a, b) => a - b);
        let delay = 0;

        for (const size of sizes) {
            if (size <= conferenceSize) {
                delay = this.sourceSignalingDelays[size];
            } else {
                break;
            }
        }

        return delay;
    }

    // Getter methods for compatibility
    get getConferenceStartTimeout() {
        return this.conferenceStartTimeout;
    }

    get isEnableAutoOwner() {
        return this.enableAutoOwner;
    }

    get isEnableModeratorChecks() {
        return this.enableModeratorChecks;
    }

    get getMaxSsrcsPerUser() {
        return this.maxSsrcsPerUser;
    }

    get getMaxSsrcGroupsPerUser() {
        return this.maxSsrcGroupsPerUser;
    }

    get getSingleParticipantTimeout() {
        return this.singleParticipantTimeout;
    }

    get getMinParticipants() {
        return this.minParticipants;
    }

    get getMaxAudioSenders() {
        return this.maxAudioSenders;
    }

    get getMaxVideoSenders() {
        return this.maxVideoSenders;
    }

    get isUseSsrcRewriting() {
        return this.useSsrcRewriting;
    }

    get isUseJsonEncodedSources() {
        return this.useJsonEncodedSources;
    }

    get isUseRandomSharedDocumentName() {
        return this.useRandomSharedDocumentName;
    }

    get getRestartRequestMinInterval() {
        return this.restartRequestMinInterval;
    }

    get getRestartRequestMaxRequests() {
        return this.restartRequestMaxRequests;
    }

    get getRestartRequestInterval() {
        return this.restartRequestInterval;
    }

    get getReinviteMethod() {
        return this.reinviteMethod;
    }

    get isStripSimulcast() {
        return this.stripSimulcast;
    }

    /**
     * Get all configuration as a JSON object
     * @returns {Object} - The configuration object
     */
    toJson() {
        return {
            conferenceStartTimeout: this.conferenceStartTimeout,
            enableAutoOwner: this.enableAutoOwner,
            enableModeratorChecks: this.enableModeratorChecks,
            maxSsrcsPerUser: this.maxSsrcsPerUser,
            maxSsrcGroupsPerUser: this.maxSsrcGroupsPerUser,
            singleParticipantTimeout: this.singleParticipantTimeout,
            minParticipants: this.minParticipants,
            maxAudioSenders: this.maxAudioSenders,
            maxVideoSenders: this.maxVideoSenders,
            useSsrcRewriting: this.useSsrcRewriting,
            useJsonEncodedSources: this.useJsonEncodedSources,
            useRandomSharedDocumentName: this.useRandomSharedDocumentName,
            restartRequestMinInterval: this.restartRequestMinInterval,
            restartRequestMaxRequests: this.restartRequestMaxRequests,
            restartRequestInterval: this.restartRequestInterval,
            reinviteMethod: this.reinviteMethod,
            stripSimulcast: this.stripSimulcast,
            sourceSignalingDelays: this.sourceSignalingDelays
        };
    }
}

// Singleton instance
const conferenceConfig = new ConferenceConfig();

module.exports = {
    ConferenceConfig,
    config: conferenceConfig
}; 