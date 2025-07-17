const assert = require('assert');
const EventEmitter = require('events');
const { createElement } = require('@xmpp/xml');
const proxyquire = require('proxyquire');

// Mock JidUtils
const JidUtils = {
    entityBareFrom: (jid) => jid,
    getResourcePart: (jid) => jid.split('/')[1] || null,
    parse: (jid) => ({ bare: () => jid.split('/')[0] })
};

class MockBridge {
    constructor(jid) {
        this.jid = jid;
        this._isOperational = true;
        this._isInGracefulShutdown = false;
        this.version = null;
        this.region = null;
        this.stress = null;
        this.relayId = null;
    }
    getJid() { return this.jid; }
    getVersion() { return this.version; }
    getRegion() { return this.region; }
    getRelayId() { return this.relayId; }
    get isOperational() { return this._isOperational && !this._isInGracefulShutdown; }
    setIsOperational(val) { this._isOperational = val; }
    get isInGracefulShutdown() { return this._isInGracefulShutdown; }
    setIsInGracefulShutdown(val) { this._isInGracefulShutdown = val; }
    updateStats(stats) { this.stress = stats.stress; }
}

class MockChatRoom extends EventEmitter {
    constructor(roomJid, xmppConnection, nickname, logger) {
        super();
        this.roomJid = roomJid;
        this.xmppConnection = xmppConnection;
        this.nickname = nickname;
        this.logger = logger || console;
        this.joined = false;
        this.presenceHandler = null;
        this.messageHandler = null;
        this.leaveCalled = false; // Track leave calls
    }
    async join() { this.joined = true; this.logger.info(`MockChatRoom: Joined ${this.roomJid}`); }
    async leave() { this.joined = false; this.leaveCalled = true; this.logger.info(`MockChatRoom: Left ${this.roomJid}`); }
    getNick() { return this.nickname; }
    getRoomJid() { return this.roomJid; }
    // removeAllListeners is part of EventEmitter
}

class MockManagedXmppConnection {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.isRegistered = true; // Assume connected for tests
        this.xmpp = {
            jid: {
                toString: () => `${config.username}@${config.domain}/${config.resource}`,
                bare: () => JidUtils.parse(`${config.username}@${config.domain}`),
                getResource: () => config.resource // Add getResource for test compatibility
            }
        };
    }
    // Add joinMuc and leaveMuc as no-op async functions for compatibility
    async joinMuc(roomJid, nickname) { /* no-op for test */ }
    async leaveMuc(roomJid, nickname, statusMessage) { /* no-op for test */ }
    // Add addPresenceListener as a no-op that returns a removal function
    addPresenceListener(handler) { return () => {}; }
    // Add other methods if BridgeMucDetector starts using them
}

const mockBridgeSelector = {
    availableBridges: new Map(),
    calls: [],
    addBridge(bridge) { this.calls.push({ name: 'addBridge', args: [bridge] }); this.availableBridges.set(bridge.getJid(), bridge);},
    removeBridge(bridge) { this.calls.push({ name: 'removeBridge', args: [bridge] }); this.availableBridges.delete(bridge.getJid()); },
    bridgeDown(bridgeJid) { this.calls.push({ name: 'bridgeDown', args: [bridgeJid] }); const b = this.availableBridges.get(bridgeJid); if (b) b.setIsOperational(false); },
    bridgeGracefulShutdown(bridgeJid) { this.calls.push({ name: 'bridgeGracefulShutdown', args: [bridgeJid] }); const b = this.availableBridges.get(bridgeJid); if (b) b.setIsInGracefulShutdown(true);},
    updateBridgeStats(bridgeJid, stats) { this.calls.push({ name: 'updateBridgeStats', args: [bridgeJid, stats] }); const b = this.availableBridges.get(bridgeJid); if (b) b.updateStats(stats);},
    reset() { this.availableBridges.clear(); this.calls = []; }
};

const mockJicofoConfig = {
    configMap: new Map(),
    getOptionalConfig(key, defaultValue) { return this.configMap.has(key) ? this.configMap.get(key) : defaultValue; },
    setConfig(key, value) { this.configMap.set(key, value); },
    reset() { this.configMap.clear(); }
};
const mockJicofoSrv = { jicofoConfig: mockJicofoConfig };

// Namespaces from BridgeMucDetector
const NS_JVB_PRESENCE = 'http://jitsi.org/protocol/jitsi-videobridge';
const NS_JITSI_MEET_PRESENCE = 'http://jitsi.org/jitmeet';
const NS_OCTO = 'urn:xmpp:octo:1';
const NS_COLIBRI_STATS = 'http://jitsi.org/protocol/colibri';

// Use proxyquire to mock dependencies
const BridgeMucDetector = proxyquire('../../src/selector/bridge/bridgeMucDetector.js', {
    './bridge.js': MockBridge,
    '../../config/serviceConfigs': { JidUtils }
});

describe('BridgeMucDetector', () => {
    let detector;
    let mockXmppConnection;
    let breweryJid = 'jvbbrewery.example.com';
    let focusNick = 'jicofo-detector-test';

    beforeEach(() => {
        mockBridgeSelector.reset();
        mockJicofoConfig.reset();
        mockXmppConnection = new MockManagedXmppConnection('client', {
            username: 'jicofo', domain: 'example.com', resource: 'test'
        });
        
        detector = new BridgeMucDetector(mockXmppConnection, mockBridgeSelector, breweryJid, focusNick, mockJicofoSrv, MockChatRoom);
    });

    afterEach(async () => {
        if (detector && detector.isRunning) {
            await detector.stop();
        }
    });

    function createJvbPresence(fromNick, params = {}) {
        const {
            version = '2.100', // Default version
            region = 'default-region',
            stress = 0.1,
            relayId = null,
            gracefulShutdown = false,
            statsId = null,
            sendJvbElement = true, // Whether to include the main <jitsi-videobridge> element
            stressLocation = 'stress-level' // 'stress-level' or 'stats-stress'
        } = params;

        const from = `${breweryJid}/${fromNick}`;
        const extensions = [];

        if (sendJvbElement) {
            const jvbElAttrs = { xmlns: NS_JVB_PRESENCE };
            if (version) jvbElAttrs.version = version;
            extensions.push(createElement('jitsi-videobridge', jvbElAttrs));
        }

        if (region) {
            extensions.push(createElement('region', { xmlns: NS_JITSI_MEET_PRESENCE }, region));
        }

        if (stressLocation === 'stress-level' && stress !== null) {
            extensions.push(createElement('stress-level', { xmlns: NS_JVB_PRESENCE }, stress.toString()));
        } else if (stressLocation === 'stats-stress' && stress !== null) {
            extensions.push(createElement('stats', { xmlns: NS_COLIBRI_STATS }, createElement('stress', {}, stress.toString())));
        }

        if (relayId) {
            extensions.push(createElement('relay', { xmlns: NS_OCTO, id: relayId }));
        }
        if (gracefulShutdown) {
            extensions.push(createElement('graceful-shutdown', { xmlns: NS_JVB_PRESENCE }));
        }
        if (statsId) {
            extensions.push(createElement('stats-id', {xmlns: NS_JITSI_MEET_PRESENCE}, statsId))
        }
        // Add <c> element for caps, assuming default features for now
        extensions.push(createElement('c', { xmlns: 'http://jabber.org/protocol/caps', hash: 'sha-1', node: 'http://jitsi.org/jitsimeet', ver: 'testver' }));


        return createElement('presence', { from, to: `${focusNick}@example.com/test` }, ...extensions);
    }

    function createChatRoomMember(fromNick, presenceStanza) {
        // For these tests, BridgeMucDetector primarily uses the JID from the member and the raw presence.
        // The ChatRoomMember object itself isn't deeply inspected by the detector's _handleMucPresence,
        // as it re-parses the presenceStanza.
        return {
            getOccupantJid: () => `${breweryJid}/${fromNick}`,
            getName: () => fromNick,
        };
    }

    it('should join the brewery MUC on start', async () => {
        const realChatRoomJoin = MockChatRoom.prototype.join;
        let joinedCalled = false;
        MockChatRoom.prototype.join = async function() { joinedCalled = true; this.joined = true; };

        await detector.start();
        assert.strictEqual(detector.chatRoom.constructor.name, 'MockChatRoom', "Detector should use the (mocked) ChatRoom");
        assert.ok(joinedCalled, 'ChatRoom.join should have been called');
        assert.ok(detector.isRunning);

        MockChatRoom.prototype.join = realChatRoomJoin; // Restore
    });

    it('should parse JVB stats from presence and add/update bridge in selector', async () => {
        await detector.start();
        const jvbComponentJid = 'jvb1.realdomain.com';
        const jvbNick = jvbComponentJid; // Assuming nick is the JVB's JID for the brewery MUC

        const presenceParams = {
            version: '2.101-test',
            region: 'test-region',
            stress: 0.35,
            relayId: 'octo123',
            statsId: 'jvb1stats'
        };
        const presence = createJvbPresence(jvbNick, presenceParams);
        const member = createChatRoomMember(jvbNick, presence);

        detector.chatRoom.emit('memberPresenceChanged', member, presence);

        assert.strictEqual(mockBridgeSelector.calls.length, 1, "addBridge should be called once");
        assert.strictEqual(mockBridgeSelector.calls[0].name, 'addBridge', "Call should be addBridge");
        const addedBridge = mockBridgeSelector.calls[0].args[0];

        assert.ok(addedBridge instanceof MockBridge, "Argument should be a MockBridge instance");
        assert.strictEqual(addedBridge.getJid(), jvbComponentJid, "Bridge JID mismatch");
        assert.strictEqual(addedBridge.getVersion(), presenceParams.version, "Version mismatch");
        assert.strictEqual(addedBridge.getRegion(), presenceParams.region, "Region mismatch");
        assert.strictEqual(addedBridge.stress, presenceParams.stress, "Stress mismatch");
        assert.strictEqual(addedBridge.getRelayId(), presenceParams.relayId, "Relay ID mismatch");
        assert.ok(addedBridge.isOperational, "Bridge should be operational");
        assert.ok(!addedBridge.isInGracefulShutdown, "Bridge should not be in graceful shutdown");

        // Simulate an update
        const updatedPresenceParams = { ...presenceParams, stress: 0.77, version: '2.102-test' };
        const updatedPresence = createJvbPresence(jvbNick, updatedPresenceParams);
        detector.chatRoom.emit('memberPresenceChanged', member, updatedPresence);

        assert.strictEqual(mockBridgeSelector.calls.length, 2, "addBridge should be called again for update");
        assert.strictEqual(mockBridgeSelector.calls[1].name, 'addBridge');
        const updatedBridge = mockBridgeSelector.calls[1].args[0];
        assert.strictEqual(updatedBridge.getJid(), jvbComponentJid);
        assert.strictEqual(updatedBridge.stress, 0.77, "Updated stress mismatch");
        assert.strictEqual(updatedBridge.getVersion(), '2.102-test', "Updated version mismatch");
    });

    it('should parse stress from <stats><stress/> if <stress-level> is not present', async () => {
        await detector.start();
        const jvbComponentJid = 'jvb_stats_stress.example.com';
        const jvbNick = jvbComponentJid;

        const presence = createJvbPresence(jvbNick, { stress: 0.45, stressLocation: 'stats-stress' });
        const member = createChatRoomMember(jvbNick, presence);
        detector.chatRoom.emit('memberPresenceChanged', member, presence);

        const addedBridge = mockBridgeSelector.availableBridges.get(jvbComponentJid);
        assert.ok(addedBridge, "Bridge should have been added/updated");
        assert.strictEqual(addedBridge.stress, 0.45, "Stress from <stats><stress/> mismatch");
    });

    it('should mark bridge down on MUC leave', async () => {
        await detector.start();
        const jvbComponentJid = 'jvb1.example.com';
        const jvbNick = jvbComponentJid;

        // First, add the bridge
        const addPresence = createJvbPresence(jvbNick, { version: '1.0' });
        const memberObj = createChatRoomMember(jvbNick, addPresence);
        detector.chatRoom.emit('memberJoined', memberObj, addPresence);
        mockBridgeSelector.reset(); // Clear addBridge call
        // Ensure bridge is in availableBridges
        mockBridgeSelector.availableBridges.set(jvbComponentJid, new MockBridge(jvbComponentJid));

        // Then, simulate leave
        const leavePresence = createElement('presence', { from: `${breweryJid}/${jvbNick}`, type: 'unavailable' });
        detector.chatRoom.emit('memberLeft', memberObj, leavePresence);

        assert.strictEqual(mockBridgeSelector.calls.length, 1);
        assert.strictEqual(mockBridgeSelector.calls[0].name, 'bridgeDown');
        assert.strictEqual(mockBridgeSelector.calls[0].args[0], jvbComponentJid);
    });

    it('should handle graceful shutdown presence', async () => {
        await detector.start();
        const jvbComponentJid = 'jvb-gs.example.com';
        const jvbNick = jvbComponentJid;

        const presence = createJvbPresence(jvbNick, { gracefulShutdown: true });
        const member = createChatRoomMember(jvbNick, presence);
        detector.chatRoom.emit('memberPresenceChanged', member, presence);

        const addedBridge = mockBridgeSelector.availableBridges.get(jvbComponentJid);
        assert.ok(addedBridge);
        assert.ok(addedBridge.isInGracefulShutdown, 'Bridge should be in graceful shutdown');
        assert.ok(!addedBridge.isOperational, 'Bridge in graceful shutdown should not be operational for new selection');
    });

    it('should stop and leave MUC', async () => {
        await detector.start();
        const chatRoomRef = detector.chatRoom;
        await detector.stop();
        // Check leaveCalled on the correct instance
        assert.ok(chatRoomRef.leaveCalled, 'ChatRoom.leave should have been called');
        assert.ok(!detector.isRunning);
        assert.strictEqual(detector.chatRoom, null);
    });

});
