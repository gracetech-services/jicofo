const loggerModule = require('../../utils/logger'); // Assuming a global logger or pass one in

/**
 * Represents a Jitsi Videobridge (JVB) instance.
 * This class will hold information about a bridge and its state.
 */
class Bridge {
    /**
     * @param {string} jid - The JID of the JVB (e.g., "jvb1.example.com").
     * @param {string|null} [relayId=null] - The Octo relay ID of the bridge, if available.
     * @param {string|null} [region=null] - The region of the bridge.
     * @param {string|null} [version=null] - The reported version of the JVB software.
     */
    constructor(jid, relayId = null, region = null, version = null) {
        this.jid = jid; // Full JID of the bridge component
        this.relayId = relayId;
        this.region = region;
        this.version = version;

        this.isOperational = true; // Assume operational until a failure
        this.isInGracefulShutdown = false;
        this.stats = {}; // Placeholder for any stats we might gather (e.g., stress, participant count)

        this.logger = loggerModule.child({ component: 'Bridge', jid: this.jid });
        this.logger.info(`Bridge instance created. RelayId: ${this.relayId}, Region: ${this.region}, Version: ${this.version}`);
    }

    getJid() {
        return this.jid;
    }

    getRelayId() {
        return this.relayId;
    }

    setRelayId(relayId) {
        if (this.relayId && this.relayId !== relayId) {
            this.logger.warn(`Relay ID changed from ${this.relayId} to ${relayId}`);
        }
        this.relayId = relayId;
    }

    getRegion() {
        return this.region;
    }

    setRegion(region) {
        this.region = region;
    }

    getVersion() {
        return this.version;
    }

    setVersion(version) {
        this.version = version;
    }

    // Make isOperational a getter to ensure consistency with isInGracefulShutdown
    get isOperational() {
        // A bridge in graceful shutdown is not operational for new allocations.
        return this._isOperational && !this.isInGracefulShutdown;
    }

    // Internal property for direct operational status
    _isOperational = true;

    setIsOperational(isOperational) {
        const newOperationalState = !!isOperational;
        if (this._isOperational !== newOperationalState) {
            this.logger.info(`Operational status (direct) changed to: ${newOperationalState}`);
            this._isOperational = newOperationalState;
        }
    }

    // Make isInGracefulShutdown a getter
    get isInGracefulShutdown() {
        return this._isInGracefulShutdown;
    }

    _isInGracefulShutdown = false;

    setIsInGracefulShutdown(inShutdown) {
        const newShutdownState = !!inShutdown;
        if (this._isInGracefulShutdown !== newShutdownState) {
            this.logger.info(`Graceful shutdown status changed to: ${newShutdownState}`);
            this._isInGracefulShutdown = newShutdownState;
            // No longer automatically setting _isOperational to false here,
            // the getter for isOperational will handle it.
            // This allows the bridge to still be "technically" operational for existing conferences
            // but not for new ones if only isInGracefulShutdown is true.
        }
    }

    // TODO: Add methods for updating stats, stress level, participant count from presence or other sources.

    getDebugState() {
        return {
            jid: this.jid,
            relayId: this.relayId,
            region: this.region,
            version: this.version,
            isOperational: this.isOperational, // Uses the getter
            isInGracefulShutdown: this.isInGracefulShutdown, // Uses the getter
            stress: this.stress,
            stats: this.stats // Generic stats object
        };
    }

    /**
     * Updates the stats for this bridge.
     * @param {object} newStats - Object containing new stats, e.g., { stress: 0.1, participantCount: 10 }.
     */
    updateStats(newStats = {}) {
        if (newStats.stress !== undefined) {
            this.stress = parseFloat(newStats.stress);
            if (isNaN(this.stress) || this.stress < 0 || this.stress > 1) {
                this.logger.warn(`Invalid stress value received: ${newStats.stress}. Clamping to 0-1 or ignoring.`);
                this.stress = Math.max(0, Math.min(1, this.stress || 0));
            }
        }
        // Can update other stats like global participant count on this bridge
        if (newStats.participantCount !== undefined) {
            this.stats.globalParticipantCount = parseInt(newStats.participantCount, 10);
        }
        this.logger.debug(`Stats updated: stress=${this.stress}, globalParticipants=${this.stats.globalParticipantCount}`);
    }
}

// Initialize stress if not passed in constructor
Bridge.prototype.stress = 0; // Default stress if not reported

module.exports = Bridge;
