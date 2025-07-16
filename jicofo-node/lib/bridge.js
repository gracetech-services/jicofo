// bridge.js
// Bridge model for Jicofo Node.js, ported from Kotlin Bridge class

class Bridge {
    constructor(jid, region = null, version = null) {
        this.jid = jid; // XMPP JID string
        this.region = region;
        this.version = version;
        this.isOperational = true;
        this.isShuttingDown = false;
        this.isInGracefulShutdown = false;
        this.isDraining = false;
        this.stats = {};
        this.lastReportedStressLevel = 0;
        this.fullVersion = version;
        this.endpointCount = 0;
        this.lastHealthCheck = Date.now();
    }

    setStats(stats) {
        this.stats = stats || {};
        if (stats && typeof stats.stress_level === 'number') {
            this.lastReportedStressLevel = stats.stress_level;
        }
        if (stats && typeof stats.region === 'string') {
            this.region = stats.region;
        }
        if (stats && typeof stats.version === 'string') {
            this.fullVersion = stats.version;
        }
        // Add more stats fields as needed
    }

    endpointAdded() {
        this.endpointCount++;
    }

    endpointRemoved() {
        this.endpointCount = Math.max(0, this.endpointCount - 1);
    }

    get debugState() {
        return {
            jid: this.jid,
            region: this.region,
            version: this.version,
            isOperational: this.isOperational,
            isShuttingDown: this.isShuttingDown,
            isInGracefulShutdown: this.isInGracefulShutdown,
            isDraining: this.isDraining,
            endpointCount: this.endpointCount,
            lastReportedStressLevel: this.lastReportedStressLevel
        };
    }

    toString() {
        return `[Bridge jid=${this.jid} region=${this.region} version=${this.version} operational=${this.isOperational}]`;
    }
}

module.exports = Bridge; 