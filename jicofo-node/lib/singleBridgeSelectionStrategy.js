// singleBridgeSelectionStrategy.js
const BridgeSelectionStrategy = require('./bridgeSelectionStrategy');

class SingleBridgeSelectionStrategy extends BridgeSelectionStrategy {
    doSelect(bridges, conferenceBridges, participantProperties) {
        if (!conferenceBridges || conferenceBridges.size === 0) {
            // No bridge in use yet: pick least loaded in region, else least loaded
            const region = participantProperties.region;
            const inRegion = this.leastLoadedInRegion ? this.leastLoadedInRegion(bridges, conferenceBridges, participantProperties, region) : null;
            if (inRegion) return inRegion;
            return this.leastLoaded(bridges);
        } else if (conferenceBridges.size !== 1) {
            // Unexpected: more than one bridge in conference
            return null;
        }
        const bridge = Array.from(conferenceBridges.keys())[0];
        if (!bridge.isOperational) return null;
        return bridge;
    }
}

module.exports = SingleBridgeSelectionStrategy; 