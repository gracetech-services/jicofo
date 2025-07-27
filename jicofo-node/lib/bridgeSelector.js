// bridgeSelector.js
// Core BridgeSelector for Jicofo Node.js, ported from Kotlin

const EventEmitter = require('events');
const Bridge = require('./bridge');
const { createBridgeSelectionStrategy } = require('./bridgeStrategyFactory');

class BridgeSelector extends EventEmitter {
    /**
     * @param {object} options
     * @param {string|object} [options.strategyConfig] - Strategy name or config object
     * @param {object} [options.clock] - Optional clock (for testing)
     */
    constructor({ strategyConfig = 'region', clock = Date } = {}) {
        super();
        this.clock = clock;
        this.strategy = createBridgeSelectionStrategy(strategyConfig);
        this.bridges = new Map(); // jid -> Bridge
    }

    /**
     * Add or update a bridge by JID and stats.
     * @param {string} jid
     * @param {object} stats
     * @returns {Bridge}
     */
    addBridge(jid, stats = null) {
        let bridge = this.bridges.get(jid);
        if (bridge) {
            const wasShuttingDown = bridge.isShuttingDown;
            bridge.setStats(stats);
            if (!wasShuttingDown && bridge.isShuttingDown) {
                this.emit('bridgeShuttingDown', bridge);
            }
        } else {
            bridge = new Bridge(jid);
            if (stats) bridge.setStats(stats);
            this.bridges.set(jid, bridge);
            this.emit('bridgeAdded', bridge);
        }
        return bridge;
    }

    /**
     * Remove a bridge by JID.
     * @param {string} jid
     */
    removeBridge(jid) {
        const bridge = this.bridges.get(jid);
        if (bridge) {
            this.bridges.delete(jid);
            this.emit('bridgeRemoved', bridge);
        }
    }

    /**
     * Mark a bridge as healthy.
     * @param {string} jid
     */
    healthCheckPassed(jid) {
        const bridge = this.bridges.get(jid);
        if (bridge) bridge.isOperational = true;
    }

    /**
     * Mark a bridge as unhealthy.
     * @param {string} jid
     */
    healthCheckFailed(jid) {
        const bridge = this.bridges.get(jid);
        if (bridge) {
            bridge.isOperational = false;
            this.emit('bridgeFailedHealthCheck', bridge);
        }
    }

    /**
     * Mark a bridge as timed out (less severe than failed).
     * @param {string} jid
     */
    healthCheckTimedOut(jid) {
        const bridge = this.bridges.get(jid);
        if (bridge) bridge.isOperational = false;
    }

    /**
     * Select a bridge for a participant.
     * @param {Map<Bridge, object>} conferenceBridges
     * @param {object} participantProperties
     * @param {string|null} version
     * @returns {Bridge|null}
     */
    selectBridge(conferenceBridges = new Map(), participantProperties = {}, version = null) {
        // Filter bridges by operational, shutdown, version, etc.
        let candidateBridges = Array.from(this.bridges.values());
        candidateBridges = candidateBridges.filter(b => b.isOperational && !b.isShuttingDown);
        if (version) {
            candidateBridges = candidateBridges.filter(b => b.fullVersion === version);
        }
        // Prefer bridges not draining or in graceful shutdown
        let activeBridges = candidateBridges.filter(b => !b.isDraining);
        if (activeBridges.length > 0) candidateBridges = activeBridges;
        let runningBridges = candidateBridges.filter(b => !b.isInGracefulShutdown);
        if (runningBridges.length > 0) candidateBridges = runningBridges;
        if (candidateBridges.length === 0) return null;
        // Use strategy
        const bridge = this.strategy.select(candidateBridges, conferenceBridges, participantProperties, true);
        if (bridge) bridge.endpointAdded();
        return bridge;
    }

    /**
     * Get debug state for all bridges.
     */
    get debugState() {
        return {
            strategy: this.strategy.constructor.name,
            bridges: Array.from(this.bridges.values()).map(b => b.debugState)
        };
    }
}

module.exports = BridgeSelector; 