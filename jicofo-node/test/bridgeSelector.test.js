// bridgeSelector.test.js
const { expect } = require('chai');
const Bridge = require('../lib/bridge');
const BridgeSelector = require('../lib/bridgeSelector');
const RegionBasedBridgeSelectionStrategy = require('../lib/regionBasedBridgeSelectionStrategy');

describe('BridgeSelector', () => {
    let selector;
    beforeEach(() => {
        selector = new BridgeSelector({ strategy: new RegionBasedBridgeSelectionStrategy() });
    });

    it('should add and remove bridges', () => {
        selector.addBridge('jvb1', { region: 'us-east', stress_level: 0.1 });
        selector.addBridge('jvb2', { region: 'us-west', stress_level: 0.2 });
        expect(selector.bridges.size).to.equal(2);
        selector.removeBridge('jvb1');
        expect(selector.bridges.size).to.equal(1);
    });

    it('should mark bridges as healthy/unhealthy', () => {
        selector.addBridge('jvb1', { region: 'us-east', stress_level: 0.1 });
        selector.healthCheckFailed('jvb1');
        expect(selector.bridges.get('jvb1').isOperational).to.be.false;
        selector.healthCheckPassed('jvb1');
        expect(selector.bridges.get('jvb1').isOperational).to.be.true;
    });

    it('should select a bridge in the participant region', () => {
        selector.addBridge('jvb1', { region: 'us-east', stress_level: 0.1 });
        selector.addBridge('jvb2', { region: 'us-west', stress_level: 0.2 });
        const participant = { region: 'us-west' };
        const selected = selector.selectBridge(new Map(), participant);
        expect(selected.region).to.equal('us-west');
    });

    it('should fallback to least loaded if no region match', () => {
        selector.addBridge('jvb1', { region: 'us-east', stress_level: 0.1 });
        selector.addBridge('jvb2', { region: 'us-west', stress_level: 0.2 });
        const participant = { region: 'eu-central' };
        const selected = selector.selectBridge(new Map(), participant);
        expect(['us-east', 'us-west']).to.include(selected.region);
    });

    it('should not select unhealthy bridges', () => {
        selector.addBridge('jvb1', { region: 'us-east', stress_level: 0.1 });
        selector.addBridge('jvb2', { region: 'us-west', stress_level: 0.2 });
        selector.healthCheckFailed('jvb1');
        selector.healthCheckFailed('jvb2');
        const selected = selector.selectBridge(new Map(), { region: 'us-east' });
        expect(selected).to.be.null;
    });
});

describe('BridgeSelector config-driven strategy selection', () => {
    it('should use region strategy when configured', () => {
        const selector = new BridgeSelector({ strategyConfig: 'region' });
        expect(selector.strategy.constructor.name).to.equal('RegionBasedBridgeSelectionStrategy');
    });
    it('should use split strategy when configured', () => {
        const selector = new BridgeSelector({ strategyConfig: 'split' });
        expect(selector.strategy.constructor.name).to.equal('SplitBridgeSelectionStrategy');
    });
    it('should use visitor strategy with nested strategies when configured', () => {
        const config = { type: 'visitor', participant: 'region', visitor: 'single' };
        const selector = new BridgeSelector({ strategyConfig: config });
        expect(selector.strategy.constructor.name).to.equal('VisitorSelectionStrategy');
        expect(selector.strategy.participantStrategy.constructor.name).to.equal('RegionBasedBridgeSelectionStrategy');
        expect(selector.strategy.visitorStrategy.constructor.name).to.equal('SingleBridgeSelectionStrategy');
    });
});
