// visitorSelectionStrategy.js
const BridgeSelectionStrategy = require('./bridgeSelectionStrategy');

class VisitorSelectionStrategy extends BridgeSelectionStrategy {
    constructor(participantStrategy, visitorStrategy) {
        super();
        this.participantStrategy = participantStrategy;
        this.visitorStrategy = visitorStrategy;
    }

    doSelect(bridges, conferenceBridges, participantProperties) {
        // Filter bridges by visitor/participant type
        const eligibleBridges = bridges.filter(b => {
            const confProps = conferenceBridges.get(b);
            return !confProps || confProps.visitor === participantProperties.visitor;
        });
        const confBridgesOfType = new Map(
            Array.from(conferenceBridges.entries()).filter(([, props]) => props.visitor === participantProperties.visitor)
        );
        const strategy = participantProperties.visitor ? this.visitorStrategy : this.participantStrategy;
        // Try eligible bridges first
        let result = strategy.doSelect(eligibleBridges, confBridgesOfType, participantProperties);
        if (result) return result;
        // Fallback: allow mixing
        return strategy.doSelect(bridges, conferenceBridges, participantProperties);
    }
}

module.exports = VisitorSelectionStrategy; 