const { expect } = require('chai');
const proxyquire = require('proxyquire');
const sinon = require('sinon');

// Mock Bridge class
const MockBridge = class {
    constructor(jid) {
        this.jid = jid;
        this.componentType = null;
    }
};

// Mock BridgeSelector
const MockBridgeSelector = class {
    constructor() {
        this.bridges = new Map();
    }

    addBridge(bridge) {
        this.bridges.set(bridge.jid, bridge);
    }

    removeBridge(jid) {
        this.bridges.delete(jid);
    }
};

// Mock XMPP connection
const mockXmppConnection = {
    config: {
        domain: 'test.example.com'
    },
    discoverComponents: async () => new Set(),
    isJvbComponent: async () => false
};

// Mock logger
const mockLogger = {
    child: () => ({
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {}
    })
};

describe('BridgeComponentDetector', () => {
    let BridgeComponentDetector;
    let bridgeComponentDetector;
    let bridgeSelector;
    let clock;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
        
        BridgeComponentDetector = proxyquire('../../../src/selector/bridge/bridgeComponentDetector', {
            '../../utils/logger': mockLogger,
            './bridge': MockBridge
        });

        bridgeSelector = new MockBridgeSelector();
        bridgeComponentDetector = new BridgeComponentDetector(
            mockXmppConnection,
            bridgeSelector,
            'test.example.com'
        );
    });

    afterEach(() => {
        clock.restore();
        if (bridgeComponentDetector.isRunning) {
            bridgeComponentDetector.stop();
        }
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            expect(bridgeComponentDetector.xmppConnection).to.equal(mockXmppConnection);
            expect(bridgeComponentDetector.bridgeSelector).to.equal(bridgeSelector);
            expect(bridgeComponentDetector.domain).to.equal('test.example.com');
            expect(bridgeComponentDetector.isRunning).to.be.false;
            expect(bridgeComponentDetector.discoveredJvbs).to.be.instanceOf(Set);
        });
    });

    describe('start', () => {
        it('should start the detector and perform initial discovery', async () => {
            const discoverSpy = sinon.spy(bridgeComponentDetector, '_discoverJvbs');
            
            await bridgeComponentDetector.start();
            
            expect(bridgeComponentDetector.isRunning).to.be.true;
            expect(discoverSpy.calledOnce).to.be.true;
            expect(bridgeComponentDetector.discoveryInterval).to.not.be.null;
        });

        it('should not start if already running', async () => {
            await bridgeComponentDetector.start();
            const discoverSpy = sinon.spy(bridgeComponentDetector, '_discoverJvbs');
            
            await bridgeComponentDetector.start();
            
            expect(discoverSpy.called).to.be.false;
        });
    });

    describe('stop', () => {
        it('should stop the detector and clear interval', async () => {
            await bridgeComponentDetector.start();
            
            bridgeComponentDetector.stop();
            
            expect(bridgeComponentDetector.isRunning).to.be.false;
            expect(bridgeComponentDetector.discoveryInterval).to.be.null;
        });

        it('should not stop if not running', () => {
            bridgeComponentDetector.stop();
            expect(bridgeComponentDetector.isRunning).to.be.false;
        });
    });

    describe('_discoverJvbs', () => {
        it('should discover JVB components and add them to selector', async () => {
            const mockComponents = new Set([
                { type: 'jitsi-videobridge', address: 'jvb1.test.example.com' },
                { type: 'jitsi-videobridge', address: 'jvb2.test.example.com' }
            ]);

            mockXmppConnection.discoverComponents = async () => mockComponents;
            mockXmppConnection.isJvbComponent = async (jid) => {
                return jid.includes('jvb');
            };

            await bridgeComponentDetector._discoverJvbs();

            expect(bridgeComponentDetector.discoveredJvbs.size).to.equal(2);
            expect(bridgeComponentDetector.discoveredJvbs.has('jvb1.test.example.com')).to.be.true;
            expect(bridgeComponentDetector.discoveredJvbs.has('jvb2.test.example.com')).to.be.true;
            expect(bridgeSelector.bridges.size).to.equal(2);
        });

        it('should remove JVBs that are no longer available', async () => {
            // First discovery
            const mockComponents1 = new Set([
                { type: 'jitsi-videobridge', address: 'jvb1.test.example.com' },
                { type: 'jitsi-videobridge', address: 'jvb2.test.example.com' }
            ]);

            mockXmppConnection.discoverComponents = async () => mockComponents1;
            mockXmppConnection.isJvbComponent = async () => true;

            await bridgeComponentDetector._discoverJvbs();

            expect(bridgeComponentDetector.discoveredJvbs.size).to.equal(2);
            expect(bridgeSelector.bridges.size).to.equal(2);

            // Second discovery - only one JVB available
            const mockComponents2 = new Set([
                { type: 'jitsi-videobridge', address: 'jvb1.test.example.com' }
            ]);

            mockXmppConnection.discoverComponents = async () => mockComponents2;

            await bridgeComponentDetector._discoverJvbs();

            expect(bridgeComponentDetector.discoveredJvbs.size).to.equal(1);
            expect(bridgeComponentDetector.discoveredJvbs.has('jvb1.test.example.com')).to.be.true;
            expect(bridgeComponentDetector.discoveredJvbs.has('jvb2.test.example.com')).to.be.false;
            expect(bridgeSelector.bridges.size).to.equal(1);
        });

        it('should handle discovery errors gracefully', async () => {
            mockXmppConnection.discoverComponents = async () => {
                throw new Error('Discovery failed');
            };

            await bridgeComponentDetector._discoverJvbs();

            expect(bridgeComponentDetector.discoveredJvbs.size).to.equal(0);
            expect(bridgeSelector.bridges.size).to.equal(0);
        });
    });

    describe('_addJvbToSelector', () => {
        it('should add JVB to selector with component type', () => {
            bridgeComponentDetector._addJvbToSelector('jvb1.test.example.com', 'jitsi-videobridge');

            expect(bridgeSelector.bridges.has('jvb1.test.example.com')).to.be.true;
            const bridge = bridgeSelector.bridges.get('jvb1.test.example.com');
            expect(bridge.componentType).to.equal('jitsi-videobridge');
        });

        it('should handle errors when adding JVB', () => {
            bridgeSelector.addBridge = () => {
                throw new Error('Failed to add bridge');
            };

            expect(() => {
                bridgeComponentDetector._addJvbToSelector('jvb1.test.example.com', 'jitsi-videobridge');
            }).to.not.throw();
        });
    });

    describe('_removeJvbFromSelector', () => {
        it('should remove JVB from selector', () => {
            bridgeComponentDetector._addJvbToSelector('jvb1.test.example.com', 'jitsi-videobridge');
            expect(bridgeSelector.bridges.size).to.equal(1);

            bridgeComponentDetector._removeJvbFromSelector('jvb1.test.example.com');
            expect(bridgeSelector.bridges.size).to.equal(0);
        });

        it('should handle errors when removing JVB', () => {
            bridgeSelector.removeBridge = () => {
                throw new Error('Failed to remove bridge');
            };

            expect(() => {
                bridgeComponentDetector._removeJvbFromSelector('jvb1.test.example.com');
            }).to.not.throw();
        });
    });

    describe('getDiscoveredJvbs', () => {
        it('should return copy of discovered JVBs', async () => {
            const mockComponents = new Set([
                { type: 'jitsi-videobridge', address: 'jvb1.test.example.com' }
            ]);

            mockXmppConnection.discoverComponents = async () => mockComponents;
            mockXmppConnection.isJvbComponent = async () => true;

            await bridgeComponentDetector._discoverJvbs();

            const discoveredJvbs = bridgeComponentDetector.getDiscoveredJvbs();
            expect(discoveredJvbs).to.be.instanceOf(Set);
            expect(discoveredJvbs.size).to.equal(1);
            expect(discoveredJvbs.has('jvb1.test.example.com')).to.be.true;
        });
    });

    describe('getDebugState', () => {
        it('should return debug state', async () => {
            await bridgeComponentDetector.start();

            const debugState = bridgeComponentDetector.getDebugState();

            expect(debugState).to.have.property('isRunning', true);
            expect(debugState).to.have.property('domain', 'test.example.com');
            expect(debugState).to.have.property('discoveredJvbs').that.is.an('array');
            expect(debugState).to.have.property('totalDiscovered').that.is.a('number');
        });
    });

    describe('periodic discovery', () => {
        it('should perform periodic discovery', async () => {
            const discoverSpy = sinon.spy(bridgeComponentDetector, '_discoverJvbs');
            
            await bridgeComponentDetector.start();
            
            // Advance time by 30 seconds
            clock.tick(30000);
            
            expect(discoverSpy.calledTwice).to.be.true; // Initial + periodic
        });

        it('should stop periodic discovery when stopped', async () => {
            const discoverSpy = sinon.spy(bridgeComponentDetector, '_discoverJvbs');
            
            await bridgeComponentDetector.start();
            bridgeComponentDetector.stop();
            
            // Advance time by 30 seconds
            clock.tick(30000);
            
            expect(discoverSpy.calledOnce).to.be.true; // Only initial discovery
        });
    });
}); 