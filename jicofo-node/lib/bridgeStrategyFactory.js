// bridgeStrategyFactory.js
// Factory for bridge selection strategies based on config string

const RegionBasedBridgeSelectionStrategy = require('./regionBasedBridgeSelectionStrategy');
const IntraRegionBridgeSelectionStrategy = require('./intraRegionBridgeSelectionStrategy');
const SplitBridgeSelectionStrategy = require('./splitBridgeSelectionStrategy');
const SingleBridgeSelectionStrategy = require('./singleBridgeSelectionStrategy');
const VisitorSelectionStrategy = require('./visitorSelectionStrategy');

/**
 * Returns a bridge selection strategy instance based on config.
 * @param {object|string} config - Strategy name or config object
 * @returns {BridgeSelectionStrategy}
 */
function createBridgeSelectionStrategy(config) {
    if (typeof config === 'string') {
        switch (config) {
            case 'region':
                return new RegionBasedBridgeSelectionStrategy();
            case 'intra-region':
                return new IntraRegionBridgeSelectionStrategy();
            case 'split':
                return new SplitBridgeSelectionStrategy();
            case 'single':
                return new SingleBridgeSelectionStrategy();
            default:
                throw new Error(`Unknown bridge selection strategy: ${config}`);
        }
    } else if (typeof config === 'object' && config.type === 'visitor') {
        // Nested strategies for visitor/participant
        const participantStrategy = createBridgeSelectionStrategy(config.participant || 'region');
        const visitorStrategy = createBridgeSelectionStrategy(config.visitor || 'region');
        return new VisitorSelectionStrategy(participantStrategy, visitorStrategy);
    } else {
        // Default
        return new RegionBasedBridgeSelectionStrategy();
    }
}

module.exports = { createBridgeSelectionStrategy }; 