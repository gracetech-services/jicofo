class ConferenceStore {
    constructor() {
        this.conferences = new Map();
        // Periodic expiration check (every 10 seconds)
        setInterval(() => this.expireConferences(), 10000);
    }

    createConference(room, properties = {}) {
        if (!this.conferences.has(room)) {
            this.conferences.set(room, {
                room,
                properties: { ...properties },
                rtcstatsState: {}, // Placeholder
                debugState: {}, // Placeholder
                pinned: false,
                avModeration: {
                    audio: { enabled: false, whitelist: [] },
                    video: { enabled: false, whitelist: [] }
                },
                participants: [],
                createdAt: Date.now(),
                lastActivity: Date.now(),
                stoppedAt: null,
                stopReason: null
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

    // Add a participant and update lastActivity
    addParticipant(room, participant) {
        const conf = this.getConference(room);
        if (!conf) return;
        conf.participants.push(participant);
        conf.lastActivity = Date.now();
    }

    // Remove a participant and update lastActivity
    removeParticipant(room, participantId) {
        const conf = this.getConference(room);
        if (!conf) return;
        conf.participants = conf.participants.filter(p => p.id !== participantId);
        conf.lastActivity = Date.now();
        // If no participants left, stop the conference
        if (conf.participants.length === 0) {
            this.stopConference(room, 'all participants left');
        }
    }

    // Stop and remove a conference
    stopConference(room, reason = 'stopped') {
        const conf = this.getConference(room);
        if (!conf) return;
        conf.stoppedAt = Date.now();
        conf.stopReason = reason;
        // Clean up resources if needed (e.g., timers, listeners)
        this.conferences.delete(room);
        // Optionally: emit event or notify listeners
    }

    // Periodic expiration logic
    expireConferences() {
        const now = Date.now();
        const singleParticipantTimeout = 2 * 60 * 1000; // 2 minutes
        const conferenceStartTimeout = 1 * 60 * 1000; // 1 minute
        for (const [room, conf] of this.conferences.entries()) {
            if (conf.stoppedAt) continue;
            // Destroy if no participants
            if (conf.participants.length === 0) {
                this.stopConference(room, 'no participants');
            }
            // Destroy if only one participant for too long
            else if (conf.participants.length === 1 && now - conf.lastActivity > singleParticipantTimeout) {
                this.stopConference(room, 'single participant timeout');
            }
            // Destroy if never started (no participants ever joined)
            else if (conf.participants.length === 0 && now - conf.createdAt > conferenceStartTimeout) {
                this.stopConference(room, 'conference start timeout');
            }
        }
    }

    // AV moderation methods (unchanged)
    setAvModerationEnabled(room, mediaType, enabled) {
        const conf = this.getConference(room);
        if (!conf || !['audio', 'video'].includes(mediaType)) return;
        const oldEnabled = conf.avModeration[mediaType].enabled;
        conf.avModeration[mediaType].enabled = !!enabled;
        if (!oldEnabled && enabled) {
            this.muteAllParticipants(room, mediaType);
        }
    }
    setAvModerationWhitelist(room, mediaType, whitelist) {
        const conf = this.getConference(room);
        if (!conf || !['audio', 'video'].includes(mediaType)) return;
        conf.avModeration[mediaType].whitelist = Array.isArray(whitelist) ? whitelist : [];
    }
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
    getAvModerationState(room) {
        const conf = this.getConference(room);
        if (!conf) return null;
        return conf.avModeration;
    }
}

module.exports = new ConferenceStore(); 