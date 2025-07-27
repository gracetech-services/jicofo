// bridgeSelectionStrategy.js
// Abstract bridge selection strategy and helpers, ported from Kotlin

class BridgeSelectionStrategy {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * Selects a bridge for a new participant in a conference.
     * @param {Bridge[]} bridges - List of candidate bridges (operational, filtered).
     * @param {Map<Bridge, object>} conferenceBridges - Map of bridges already in use by the conference.
     * @param {object} participantProperties - Properties of the participant (e.g., region).
     * @param {boolean} allowMultiBridge - Whether multi-bridge is allowed.
     * @returns {Bridge|null}
     */
    select(bridges, conferenceBridges, participantProperties, allowMultiBridge) {
        if (!conferenceBridges || conferenceBridges.size === 0) {
            const bridge = this.doSelect(bridges, conferenceBridges, participantProperties);
            return bridge;
        } else {
            const existingBridge = Array.from(conferenceBridges.keys())[0];
            if (!allowMultiBridge || !existingBridge.relayId) {
                return existingBridge;
            }
            const bridge = this.doSelect(bridges, conferenceBridges, participantProperties);
            return bridge;
        }
    }

    // --- Helper methods for subclasses ---
    notLoadedAlreadyInConferenceInRegion(bridges, conferenceBridges, participantProperties, desiredRegion) {
        return bridges
            .filter(b => !this.isOverloaded(b, conferenceBridges))
            .filter(b => conferenceBridges.has(b))
            .find(b => desiredRegion && b.region === desiredRegion) || null;
    }

    notLoadedInRegion(bridges, conferenceBridges, participantProperties, desiredRegion) {
        return bridges
            .filter(b => !this.isOverloaded(b, conferenceBridges))
            .find(b => desiredRegion && b.region === desiredRegion) || null;
    }

    notLoaded(bridges, conferenceBridges, participantProperties) {
        return bridges.find(b => !this.isOverloaded(b, conferenceBridges)) || null;
    }

    leastLoaded(bridges) {
        return bridges.length > 0 ? bridges[0] : null;
    }

    isOverloaded(bridge, conferenceBridges) {
        // Overload logic: can be extended with config
        return bridge.lastReportedStressLevel > (this.config.maxStressLevel || 0.8);
    }

    /**
     * Abstract method to be implemented by subclasses.
     */
    doSelect(bridges, conferenceBridges, participantProperties) {
        throw new Error('doSelect() must be implemented by subclass');
    }
}

module.exports = BridgeSelectionStrategy; 