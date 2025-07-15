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
                pinned: false
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
}

module.exports = new ConferenceStore(); 