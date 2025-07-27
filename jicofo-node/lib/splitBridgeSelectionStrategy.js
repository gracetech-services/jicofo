// splitBridgeSelectionStrategy.js
const BridgeSelectionStrategy = require('./bridgeSelectionStrategy');

class SplitBridgeSelectionStrategy extends BridgeSelectionStrategy {
    doSelect(bridges, conferenceBridges, participantProperties) {
        // If there's any bridge not yet in this conference, use that
        const notInConf = bridges.find(b => !conferenceBridges.has(b));
        if (notInConf) return notInConf;
        // Otherwise, pick the bridge in the conference with the fewest participants
        let min = null;
        let minCount = Infinity;
        for (const [bridge, props] of conferenceBridges.entries()) {
            if (bridges.includes(bridge) && props.participantCount < minCount) {
                min = bridge;
                minCount = props.participantCount;
            }
        }
        return min;
    }
}

module.exports = SplitBridgeSelectionStrategy; 