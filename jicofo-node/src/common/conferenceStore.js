class ConferenceStore {
    constructor() {
        this.conferences = new Map();
    }

    createConference(room, properties = {}) {
        if (!this.conferences.has(room)) {
            this.conferences.set(room, {
                room,
                properties: { ...properties },
                rtcstatsState: {}, // Placeholder
                debugState: {}, // Placeholder
                pinned: false,
                // AV moderation state
                avModeration: {
                    audio: { enabled: false, whitelist: [] },
                    video: { enabled: false, whitelist: [] }
                },
                // Participants: [{ id, isModerator, isMuted: { audio, video } }]
                participants: []
            });
        }
        return this.conferences.get(room);
    }

    getConference(room) {
        return this.conferences.get(room);
    }

    getAllConferences() {
        return Array.from(this.conferences.values());
    }

    // Enable/disable AV moderation for a media type
    setAvModerationEnabled(room, mediaType, enabled) {
        const conf = this.getConference(room);
        if (!conf || !['audio', 'video'].includes(mediaType)) return;
        const oldEnabled = conf.avModeration[mediaType].enabled;
        conf.avModeration[mediaType].enabled = !!enabled;
        if (!oldEnabled && enabled) {
            this.muteAllParticipants(room, mediaType);
        }
    }

    // Set whitelist for a media type
    setAvModerationWhitelist(room, mediaType, whitelist) {
        const conf = this.getConference(room);
        if (!conf || !['audio', 'video'].includes(mediaType)) return;
        conf.avModeration[mediaType].whitelist = Array.isArray(whitelist) ? whitelist : [];
    }

    // Mute all non-moderator participants for a media type
    muteAllParticipants(room, mediaType) {
        const conf = this.getConference(room);
        if (!conf) return;
        conf.participants.forEach(p => {
            if (!p.isModerator) {
                p.isMuted = p.isMuted || {};
                p.isMuted[mediaType] = true;
            }
        });
    }

    // Get AV moderation state for a conference
    getAvModerationState(room) {
        const conf = this.getConference(room);
        if (!conf) return null;
        return conf.avModeration;
    }
}

module.exports = new ConferenceStore(); 