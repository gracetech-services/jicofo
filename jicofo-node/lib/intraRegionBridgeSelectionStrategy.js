// intraRegionBridgeSelectionStrategy.js
const BridgeSelectionStrategy = require('./bridgeSelectionStrategy');

class IntraRegionBridgeSelectionStrategy extends BridgeSelectionStrategy {
    doSelect(bridges, conferenceBridges, participantProperties) {
        const participantRegion = participantProperties.region;
        if (bridges.length === 0) return null;
        if (!conferenceBridges || conferenceBridges.size === 0) {
            // Try to match the participant region for the initial selection
            const inRegion = this.notLoadedInRegion(bridges, conferenceBridges, participantProperties, participantRegion);
            if (inRegion) return inRegion;
            return this.leastLoaded(bridges);
        }
        const conferenceRegion = Array.from(conferenceBridges.keys())[0].region;
        const inConfRegion = this.notLoadedAlreadyInConferenceInRegion(bridges, conferenceBridges, participantProperties, conferenceRegion);
        if (inConfRegion) return inConfRegion;
        const inRegion = this.notLoadedInRegion(bridges, conferenceBridges, participantProperties, conferenceRegion);
        if (inRegion) return inRegion;
        // Fallback: least loaded in conference region
        return this.leastLoaded(bridges);
    }
}

module.exports = IntraRegionBridgeSelectionStrategy; 