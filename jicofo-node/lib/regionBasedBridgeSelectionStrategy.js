// regionBasedBridgeSelectionStrategy.js
// Region-based bridge selection strategy for Jicofo Node.js

const BridgeSelectionStrategy = require('./bridgeSelectionStrategy');

class RegionBasedBridgeSelectionStrategy extends BridgeSelectionStrategy {
    constructor(config = {}) {
        super(config);
    }

    /**
     * Select a bridge, preferring those in the participant's region.
     * @param {Bridge[]} bridges
     * @param {Map<Bridge, object>} conferenceBridges
     * @param {object} participantProperties
     * @returns {Bridge|null}
     */
    doSelect(bridges, conferenceBridges, participantProperties) {
        const region = participantProperties.region || null;
        // Prefer not overloaded in region
        const inRegion = this.notLoadedInRegion(bridges, conferenceBridges, participantProperties, region);
        if (inRegion) return inRegion;
        // Fallback: any not overloaded
        const notLoaded = this.notLoaded(bridges, conferenceBridges, participantProperties);
        if (notLoaded) return notLoaded;
        // Fallback: least loaded
        return this.leastLoaded(bridges);
    }
}

module.exports = RegionBasedBridgeSelectionStrategy; 