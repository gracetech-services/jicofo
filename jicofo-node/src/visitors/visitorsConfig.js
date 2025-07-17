const config = require('config');

class VisitorsConfig {
    constructor() {
        // Load configuration from config files
        this.enabled = config.get('jicofo.visitors.enabled', false);
        this.maxParticipants = config.get('jicofo.visitors.max-participants', 100);
        this.maxVisitorsPerNode = config.get('jicofo.visitors.max-visitors-per-node', 50);
        this.notificationInterval = config.get('jicofo.visitors.notification-interval', 30000); // 30 seconds default
        this.autoEnableBroadcast = config.get('jicofo.visitors.auto-enable-broadcast', false);
        this.requireMucConfigFlag = config.get('jicofo.visitors.require-muc-config-flag', false);
        this.enableLiveRoom = config.get('jicofo.visitors.enable-live-room', false);
    }

    // Getter methods for compatibility
    get isEnabled() {
        return this.enabled;
    }

    get getMaxParticipants() {
        return this.maxParticipants;
    }

    get getMaxVisitorsPerNode() {
        return this.maxVisitorsPerNode;
    }

    get getNotificationInterval() {
        return this.notificationInterval;
    }

    get isAutoEnableBroadcast() {
        return this.autoEnableBroadcast;
    }

    get isRequireMucConfigFlag() {
        return this.requireMucConfigFlag;
    }

    get isEnableLiveRoom() {
        return this.enableLiveRoom;
    }
}

// Singleton instance
const visitorsConfig = new VisitorsConfig();

module.exports = {
    VisitorsConfig,
    config: visitorsConfig
}; 