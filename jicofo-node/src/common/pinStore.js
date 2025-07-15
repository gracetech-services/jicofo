class PinStore {
    constructor() {
        this.pins = new Map();
    }

    pinConference(room, jvbVersion, durationMinutes) {
        this.pins.set(room, {
            conferenceId: room,
            jvbVersion,
            durationMinutes,
            pinnedAt: Date.now()
        });
    }

    unpinConference(room) {
        this.pins.delete(room);
    }

    getPinnedConferences() {
        return Array.from(this.pins.values());
    }
}

module.exports = new PinStore(); 