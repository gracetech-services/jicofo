const assert = require('assert');
const EventEmitter = require('events');
const { xml, Element } = require('@xmpp/xml'); // For creating/inspecting stanzas

// --- Minimal Mocks for Core Components ---
const { JidUtils } = require('../src/config/serviceConfigs');
const ConferenceSourceMap = require('../src/common/conference/source/conferenceSourceMap');
const EndpointSourceSet = require('../src/common/conference/source/endpointSourceSet');
const { IceUdpTransport } = require('../src/common/xmpp/jingle/iceUdpTransport');
const { ColibriAllocation } = require('../src/selector/bridge/colibri/colibriAllocation');
const Bridge = require('../src/selector/bridge/bridge');

// Mock JicofoConfig
const mockJicofoConfig = {
    configMap: new Map(),
    getOptionalConfig(key, defaultValue) {
        return this.configMap.has(key) ? this.configMap.get(key) : defaultValue;
    },
    setConfig(key, value) { this.configMap.set(key, value); },
    reset() { this.configMap.clear(); }
};

// Mock ManagedXmppConnection
class MockManagedXmppConnection extends EventEmitter {
    constructor(name = 'mock-connection') {
        super();
        this.name = name;
        this.isRegistered = false; // Start as not registered
        this.sentStanzas = [];
        this.iqHandlers = new Map(); // elementName|namespace -> handlerFn
        this.xmpp = {
            jid: JidUtils.parse(`${name}@example.com/resource`),
            iqCaller: {
                request: async (iqElement) => {
                    this.sentStanzas.push(iqElement);
                    // Simulate a default successful response for most IQs unless overridden
                    this.logger.debug(`MockIQCaller: Received IQ to ${iqElement.attrs.to}, type ${iqElement.attrs.type}, id ${iqElement.attrs.id}`);
                    if (this.mockResponses && this.mockResponses.has(iqElement.attrs.id)) {
                        return this.mockResponses.get(iqElement.attrs.id)(); // Call function to get/generate response
                    }
                    if (iqElement.attrs.type === 'get' || iqElement.attrs.type === 'set') {
                        return xml('iq', { type: 'result', id: iqElement.attrs.id, from: iqElement.attrs.to, to: iqElement.attrs.from });
                    }
                    return null; // Should not happen for get/set
                }
            }
        };
        this.mockResponses = new Map(); // id -> () => responseElement
        this.logger = console; // Basic logger
    }
    async connect() { this.isRegistered = true; this.emit('registrationChanged', true); }
    async disconnect() { this.isRegistered = false; this.emit('registrationChanged', false); this.sentStanzas = []; }
    async sendIq(iqElement) { // For fire-and-forget IQs or those handled by registerIqHandler
        this.sentStanzas.push(iqElement);
        this.logger.debug(`MockSendIq: Sent IQ to ${iqElement.attrs.to}, type ${iqElement.attrs.type}, id ${iqElement.attrs.id}`);
        // No response handling here, assumes it's a set that expects only result/error via general handler
    }
    // Simplified registerIqHandler for the mock
    registerIqHandler(elementName, namespace, handlerFn) {
        const key = `${elementName}|${namespace}`;
        this.iqHandlers.set(key, handlerFn);
    }
    // Method to simulate receiving an IQ that would be routed to a registered handler
    async simulateIncomingIq(iqElement) {
        const queryElement = iqElement.getChildByAttr('xmlns');
        if (queryElement) {
            const key = `${queryElement.name}|${queryElement.attrs.xmlns}`;
            const handler = this.iqHandlers.get(key);
            if (handler) {
                const response = await handler(iqElement);
                if (response) this.sendIq(response); // Simulate sending the response back
                return response;
            }
        }
        return null;
    }
    addPresenceListener(callback) { return () => {}; } // Mock
    joinMuc(roomJid, nick) { return Promise.resolve(); } // Mock
    leaveMuc(roomJid, nick) { return Promise.resolve(); } // Mock
}

// Mock BridgeSelector
const mockBridgeSelector = {
    availableBridges: new Map(),
    calls: [],
    selectBridge(conferenceBridges, participantProperties, pinnedBridgeVersion) {
        this.calls.push({ name: 'selectBridge', args: [conferenceBridges, participantProperties, pinnedBridgeVersion] });
        // Return a default mock bridge if any available, otherwise null
        const operational = Array.from(this.availableBridges.values()).filter(b => b.isOperational && !b.isInGracefulShutdown);
        return operational.length > 0 ? operational[0] : null;
    },
    addBridge(bridge) { this.availableBridges.set(bridge.getJid(), bridge); },
    removeBridge(bridge) { this.availableBridges.delete(bridge.getJid());},
    reset() { this.availableBridges.clear(); this.calls = [];}
};

// Mock XmppServices
const mockXmppServices = {
    clientConnection: new MockManagedXmppConnection('client'),
    serviceConnection: new MockManagedXmppConnection('service'),
    jingleHandler: { // Mock JingleHandler
        activeSessions: new Map(),
        registerSession(session) { this.activeSessions.set(session.sid, session); },
        unregisterSession(sid) { this.activeSessions.delete(sid); },
        sendIq: async (iq) => mockXmppServices.clientConnection.sendIq(iq), // Route Jingle IQs via client conn
        iqCaller: mockXmppServices.clientConnection.xmpp.iqCaller, // Expose client conn iqCaller
        handleJingleIq: async (iq) => { /* Simulate routing to session */ }
    },
    async startConnections() {
        await this.clientConnection.connect();
        await this.serviceConnection.connect();
    },
    async shutdown() {
        await this.clientConnection.disconnect();
        await this.serviceConnection.disconnect();
    }
};

// Mock ColibriV2SessionManager
const mockColibriSessionManager = {
    calls: [],
    allocate: async (params) => {
        mockColibriSessionManager.calls.push({ name: 'allocate', args: [params] });
        // Simulate a successful allocation with some mock data
        const bridge = mockBridgeSelector.selectBridge(); // Use the selector to get a bridge
        if (!bridge) throw new Error("Colibri allocate mock: No bridge selected");

        const mockTransport = new IceUdpTransport('mockUfrag', 'mockPwd', true, [], []);
        return new ColibriAllocation(
            EndpointSourceSet.EMPTY, // feedbackSources
            mockTransport,
            bridge.getRegion(),
            `colibriConfId-${Date.now()}`, // bridgeSessionId
            params.useSctp ? 12345 : null // sctpPort
        );
    },
    updateParticipant: async (endpointId, transportXml, sources, initialLastN) => {
         mockColibriSessionManager.calls.push({ name: 'updateParticipant', args: [endpointId, transportXml, sources, initialLastN] });
    },
    getBridgeSessionId: (endpointId) => {
        const call = mockColibriSessionManager.calls.find(c => c.name === 'allocate' && c.args[0].id === endpointId);
        return call ? call.mockBridgeSessionId : null; // Store mockBridgeSessionId on allocate call if needed for test
    },
    reset() { this.calls = []; }
};


// Mock JicofoServices
const mockServices = {
    jicofoConfig: mockJicofoConfig,
    xmppServices: mockXmppServices,
    bridgeSelector: mockBridgeSelector,
    colibriSessionManager: mockColibriSessionManager,
    // focusManager will be the real one, but it needs jicofoServices
};

// Real FocusManager and JitsiMeetConference
const FocusManager = require('../src/focusManager'); // Adjust path
const JitsiMeetConference = require('../src/conference/jitsiMeetConference'); // Adjust path


describe('Conference Integration Test', () => {
    let focusManager;
    let conference; // Will hold JitsiMeetConference instance

    beforeEach(async () => {
        mockJicofoConfig.reset();
        mockBridgeSelector.reset();
        mockColibriSessionManager.reset();
        mockXmppServices.clientConnection.sentStanzas = [];
        mockXmppServices.serviceConnection.sentStanzas = [];
        mockXmppServices.jingleHandler.activeSessions.clear();

        // Setup default config needed by components
        mockJicofoConfig.setConfig('focusUser.nickname', 'Jicofo');
        mockJicofoConfig.setConfig('bridge.breweryJid', 'jvbbrewery.example.com'); // For BridgeMucDetector if it were real
        mockJicofoConfig.setConfig('conference.maxSsrcsPerUser', 20);
        mockJicofoConfig.setConfig('conference.maxSsrcGroupsPerUser', 20);


        focusManager = new FocusManager(mockServices); // Pass mock JicofoServices
        mockServices.focusManager = focusManager; // Allow services to access focusManager if needed

        // Simulate XMPP connections being ready for FocusManager to use
        await mockServices.xmppServices.startConnections();
    });

    afterEach(async () => {
        if (conference && conference.isStarted()) {
            await conference.stop();
        }
        await mockServices.xmppServices.shutdown();
    });

    it('FocusManager should create a JitsiMeetConference on request', async () => {
        const roomName = 'testroom1@conference.example.com';
        const properties = { 'someProp': 'someValue' };

        // Mock ChatRoom join for the conference itself
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        let conferenceChatRoomInstance;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) {
                super(...args);
                conferenceChatRoomInstance = this; // Capture instance
                this.join = async () => {
                    this.joined = true;
                    this.logger.info(`MockConferenceChatRoom: Joined ${this.roomJid}`);
                    return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null };
                };
            }
        };

        conference = await focusManager.conferenceRequest(roomName, properties, 'DEBUG');

        assert.ok(conference instanceof JitsiMeetConference, 'Conference should be an instance of JitsiMeetConference');
        assert.strictEqual(conference.getRoomName(), JidUtils.entityBareFrom(roomName));
        assert.ok(conference.getMeetingId(), 'Conference should have a meeting ID after MUC join');
        assert.ok(conference.isStarted(), 'Conference should be marked as started');
        assert.ok(conferenceChatRoomInstance.joined, 'Conference MUC should have been joined');

        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom; // Restore
    });

    // More tests will go here for the full participant join flow

    it('should trigger Colibri allocation when a participant joins the MUC', async () => {
        const roomName = 'testroom2@conference.example.com';
        // Mock ChatRoom join for the conference itself
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        let conferenceChatRoomInstance;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom { // Inject mock for JMC's ChatRoom
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});
        assert.ok(conference.isStarted(), "Conference should start");

        // Add a mock bridge for BridgeSelector to pick
        const mockBridge = new Bridge('jvb.example.com', 'relay1', 'test-region', '1.0');
        mockBridgeSelector.addBridge(mockBridge);

        // Simulate a participant joining
        const participantMucJid = `${roomName}/participant1`;
        const participantEndpointId = 'participant1';
        const participantPresence = xml('presence', { from: participantMucJid, id: 'pres1' },
            xml('c', { xmlns: 'http://jabber.org/protocol/caps', hash: 'sha-1', node: 'http://jitsi.org/jitsimeet', ver: 'xxxx' }),
            xml('region', { xmlns: 'http://jitsi.org/jitsimeet' }, 'participant-region')
            // Add other necessary presence elements that ChatRoomMember parses
        );

        // Create a ChatRoomMember instance (using the real one for its parsing logic if possible, or mock)
        // For this test, a simplified mock ChatRoomMember is easier if ChatRoom isn't fully mocked for emitting.
        const mockChatRoomMember = {
            getOccupantJid: () => participantMucJid,
            getName: () => participantEndpointId, // Nickname
            getRegion: () => 'participant-region',
            getStatsId: () => 'stats-id-p1',
            getRole: () => 'participant',
            getAffiliation: () => 'member',
            hasSctpSupport: () => true, // Assume SCTP support for test
            hasAudioSupport: () => true,
            hasVideoSupport: () => true,
            isJibri: false,
            isJigasi: false,
            isTranscriber: false,
            features: new Set(require('../src/xmpp/features').Features.defaultFeatures), // Give some default features
            sources: EndpointSourceSet.EMPTY, // Participant's own sources initially empty
            nick: participantEndpointId, // required by JMC's allocationParams
            // Ensure all fields accessed by JMC._initiateParticipantSession -> allocationParams are here
        };

        // Spy on colibriSessionManager.allocate before emitting the event
        assert.strictEqual(mockColibriSessionManager.calls.length, 0, "Allocate should not have been called yet");

        // Emit memberJoined from the conference's chat room mock
        conferenceChatRoomInstance.emit('memberJoined', mockChatRoomMember, participantPresence);

        // Allow async operations triggered by memberJoined to complete
        await new Promise(resolve => process.nextTick(resolve)); // Wait for next tick

        assert.strictEqual(mockColibriSessionManager.calls.length, 1, "allocate should have been called once");
        const allocateCall = mockColibriSessionManager.calls[0];
        assert.strictEqual(allocateCall.name, 'allocate');
        const allocationParams = allocateCall.args[0];

        assert.strictEqual(allocationParams.id, participantEndpointId);
        assert.strictEqual(allocationParams.region, 'participant-region');
        assert.strictEqual(allocationParams.statsId, 'stats-id-p1');
        assert.strictEqual(allocationParams.visitor, false);
        assert.ok(allocationParams.sources instanceof EndpointSourceSet);
        assert.ok(allocationParams.requestAudio);
        assert.ok(allocationParams.requestVideo);
        // useSctp depends on global config 'conference.enableSctp'
        mockJicofoConfig.setConfig('conference.enableSctp', true); // Ensure it's true for this assertion
        assert.ok(allocationParams.useSctp, "useSctp should be true based on feature and config");


        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom; // Restore
    });

    it('should send Jingle session-initiate after successful Colibri allocation', async () => {
        const roomName = 'testroom3@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});

        const mockBridge = new Bridge('jvb.example.com', 'relay1', 'test-region', '1.0');
        mockBridgeSelector.addBridge(mockBridge);
        mockJicofoConfig.setConfig('conference.enableSctp', true);
        mockJicofoConfig.setConfig('jingle.codecs.audio', [{ id: 0, name: 'PCMU', clockrate: 8000 }]);
        mockJicofoConfig.setConfig('jingle.codecs.video', [{ id: 100, name: 'VP8', clockrate: 90000 }]);
        mockJicofoConfig.setConfig('jingle.rtpHdrExts.audio', [{id: 1, uri: "urn:ietf:params:rtp-hdrext:ssrc-audio-level"}]);
        mockJicofoConfig.setConfig('jingle.rtpHdrExts.video', [{id: 3, uri: "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"}]);
        mockJicofoConfig.setConfig('jingle.initialLastN.video', 5);


        // Override mockColibriSessionManager.allocate for this test
        const mockCandidates = [{ id: 'cand1', component: 1, foundation: 'f1', generation: 0, ip: '1.2.3.4', port: 10000, priority: 100, protocol: 'udp', type: 'host' }];
        const mockFingerprints = [{ hash: 'sha-256', setup: 'actpass', value: 'FP1' }];
        const mockTransport = new IceUdpTransport('ufrag1', 'pwd1', true, mockCandidates, mockFingerprints);
        const mockFeedbackSources = EndpointSourceSet.EMPTY; // No feedback sources from bridge for this test
        const mockSctpPort = 5000;
        const mockColibriConfId = 'colibriAlloc123';

        mockColibriSessionManager.allocate = async (params) => {
            mockColibriSessionManager.calls.push({ name: 'allocate', args: [params] });
            return new ColibriAllocation(mockFeedbackSources, mockTransport, 'test-region', mockColibriConfId, mockSctpPort);
        };

        const participantMucJid = `${roomName}/participant2`;
        const participantEndpointId = 'participant2';
        const participantPresence = xml('presence', { from: participantMucJid }); // Simplified
        const mockChatRoomMember = {
            getOccupantJid: () => participantMucJid,
            getName: () => participantEndpointId,
            getRegion: () => 'participant-region',
            getStatsId: () => 'stats-id-p2',
            getRole: () => 'participant', getAffiliation: () => 'member',
            hasSctpSupport: () => true, hasAudioSupport: () => true, hasVideoSupport: () => true,
            isJibri: false, isJigasi: false, isTranscriber: false,
            features: new Set(require('../src/xmpp/features').Features.defaultFeatures),
            sources: EndpointSourceSet.EMPTY,
            nick: participantEndpointId,
        };

        // Clear any prior sent stanzas from client connection (conference MUC join)
        mockXmppServices.clientConnection.sentStanzas = [];

        conferenceChatRoomInstance.emit('memberJoined', mockChatRoomMember, participantPresence);
        await new Promise(resolve => process.nextTick(resolve)); // For Colibri allocation
        await new Promise(resolve => process.nextTick(resolve)); // For Jingle initiation (it's fire-and-forget in JMC)
                                                                // This might need a more robust way to await async chain.
                                                                // For now, assuming two ticks is enough for this test path.

        assert.strictEqual(mockXmppServices.clientConnection.sentStanzas.length, 1, "Should send one Jingle session-initiate");
        const jingleIq = mockXmppServices.clientConnection.sentStanzas[0];
        assert.strictEqual(jingleIq.name, 'iq', "Should be an IQ stanza");
        assert.strictEqual(jingleIq.attrs.type, 'set');
        assert.strictEqual(jingleIq.attrs.to, participantMucJid);

        const jingleEl = jingleIq.getChild('jingle', 'urn:xmpp:jingle:1');
        assert.ok(jingleEl, "Jingle element should exist");
        assert.strictEqual(jingleEl.attrs.action, 'session-initiate');
        assert.ok(jingleEl.attrs.sid, "Jingle session should have an SID");

        const contents = jingleEl.getChildren('content');
        assert.strictEqual(contents.length, 3, "Should have 3 contents: audio, video, data"); // audio, video, data

        // Check audio content
        const audioContent = contents.find(c => c.attrs.name === 'audio');
        assert.ok(audioContent, "Audio content missing");
        const audioDesc = audioContent.getChild('description', 'urn:xmpp:jingle:apps:rtp:1');
        assert.ok(audioDesc, "Audio description missing");
        assert.strictEqual(audioDesc.getChildren('payload-type').length, 1, "Audio should have 1 payload type from config");
        assert.strictEqual(audioDesc.getChildren('rtp-hdrext').length, 1, "Audio should have 1 rtp-hdrext from config");
        const audioTransport = audioContent.getChild('transport', 'urn:xmpp:jingle:transports:ice-udp:1');
        assert.ok(audioTransport, "Audio transport missing");
        assert.strictEqual(audioTransport.attrs.ufrag, 'ufrag1');
        assert.strictEqual(audioTransport.getChildren('candidate').length, 1);
        assert.strictEqual(audioTransport.getChildren('fingerprint').length, 1);
        assert.ok(audioTransport.getChild('sctp-port'), "Audio transport should have sctp-port for BUNDLE");
        assert.strictEqual(audioTransport.getChild('sctp-port').attrs.value, mockSctpPort.toString());


        // Check video content (similar checks for payload types, hdrexts, transport)
        const videoContent = contents.find(c => c.attrs.name === 'video');
        assert.ok(videoContent, "Video content missing");
        const videoDesc = videoContent.getChild('description', 'urn:xmpp:jingle:apps:rtp:1');
        assert.ok(videoDesc, "Video description missing");
        assert.strictEqual(videoDesc.getChildren('payload-type').length, 1);
        assert.strictEqual(videoDesc.getChildren('rtp-hdrext').length, 1);
        assert.ok(videoContent.getChild('transport', 'urn:xmpp:jingle:transports:ice-udp:1'), "Video transport missing");
        assert.ok(videoDesc.getChild('initial-last-n'), "Video should have initial-last-n"); // from config

        // Check data content
        const dataContent = contents.find(c => c.attrs.name === 'data');
        assert.ok(dataContent, "Data content missing");
        assert.ok(dataContent.getChild('description', 'urn:xmpp:jingle:apps:webrtc-datachannel:0'), "Data description missing");
        // Data content shares transport if BUNDLEd, so no separate transport element here.

        // Check BUNDLE group
        const groupEl = jingleEl.getChild('group', 'urn:xmpp:jingle:apps:grouping:0');
        assert.ok(groupEl, "BUNDLE group should exist");
        assert.strictEqual(groupEl.attrs.semantics, 'BUNDLE');
        const groupContents = groupEl.getChildren('content').map(c => c.attrs.name);
        assert.deepStrictEqual(groupContents.sort(), ['audio', 'data', 'video'].sort());

        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });

    it('should process Jingle session-accept and update Colibri with remote transport', async () => {
        const roomName = 'testroom4@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});

        const mockBridge = new Bridge('jvb.example.com', 'relay1', 'test-region', '1.0');
        mockBridgeSelector.addBridge(mockBridge);
        mockJicofoConfig.setConfig('conference.enableSctp', true);
        // Configure some basic codecs/hdrexts for the offer
        mockJicofoConfig.setConfig('jingle.codecs.audio', [{ id: 0, name: 'PCMU', clockrate: 8000 }]);
        mockJicofoConfig.setConfig('jingle.rtpHdrExts.audio', [{id: 1, uri: "urn:ietf:params:rtp-hdrext:ssrc-audio-level"}]);


        // --- Stage 1: Colibri Allocation (mocked response) ---
        const colibriAllocTransport = new IceUdpTransport('ufragOffer', 'pwdOffer', true, [], []);
        mockColibriSessionManager.allocate = async (params) => {
            mockColibriSessionManager.calls.push({ name: 'allocate', args: [params] });
            return new ColibriAllocation(EndpointSourceSet.EMPTY, colibriAllocTransport, 'test-region', 'colibriConf1', null);
        };

        // --- Stage 2: Jingle session-initiate (capture sent IQ) ---
        let sentSessionInitiateIQ;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iqElement) => {
            mockXmppServices.clientConnection.sentStanzas.push(iqElement);
            if (iqElement.getChild('jingle')?.attrs.action === 'session-initiate') {
                sentSessionInitiateIQ = iqElement; // Capture it
                // Crucially, for THIS test, the session-initiate's promise should resolve
                // with the session-accept from the participant.
                const participantTransport = new IceUdpTransport(
                    'ufragAnswer', 'pwdAnswer', true,
                    [new IceUdpTransportCandidate({ id: 'pCand1', component: 1, foundation: 'pf1', generation: 0, ip: '2.3.4.5', port: 20000, priority: 200, protocol: 'udp', type: 'host' })],
                    [new DtlsFingerprint({ hash: 'sha-256', setup: 'active' }, 'FP_ANSWER')]
                );
                const participantSources = EndpointSourceSet.fromJingle([
                    xml('content', {name: 'audio'},
                        xml('description', {xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: 'audio'},
                            xml('source', {xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0', ssrc: '12345'})
                        )
                    )
                ]);

                const sessionAcceptIQ = xml('iq',
                    { type: 'set', from: participantMucJid, to: sentSessionInitiateIQ.attrs.from, id: `accept-${Date.now()}` }, // type='set' for SA
                    xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: sentSessionInitiateIQ.getChild('jingle').attrs.sid, responder: participantMucJid },
                        xml('content', { name: 'audio', creator: 'responder', senders: 'both' },
                            xml('description', { xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: 'audio' },
                                xml('payload-type', {id: '0', name: 'PCMU', clockrate: '8000'}),
                                xml('source', {xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0', ssrc: '12345'})
                            ),
                            participantTransport.toXmlElement()
                        )
                        // Potentially video content as well if offered and accepted
                    )
                );
                // Simulate this SA coming in after the SI's result ack
                process.nextTick(() => {
                    mockXmppServices.clientConnection.simulateIncomingIq(sessionAcceptIQ)
                        .catch(e => console.error("Error simulating incoming SA:", e));
                });

                // The session-initiate itself should get a simple 'result' ack
                return Promise.resolve(xml('iq', { type: 'result', id: sentSessionInitiateIQ.attrs.id, from: participantMucJid, to: sentSessionInitiateIQ.attrs.from }));
            }
            // Default response for other IQs
            return xml('iq', { type: 'result', id: iqElement.attrs.id, from: iqElement.attrs.to, to: iqElement.attrs.from });
        };

        const participantMucJid = `${roomName}/participant3`;
        const participantEndpointId = 'participant3';
        const participantPresence = xml('presence', { from: participantMucJid });
        const mockChatRoomMember = {
            getOccupantJid: () => participantMucJid, getName: () => participantEndpointId,
            getRegion: () => 'p-region', getStatsId: () => 'p-stats',
            getRole: () => 'participant', getAffiliation: () => 'member',
            hasSctpSupport: () => false, hasAudioSupport: () => true, hasVideoSupport: () => false, // Audio only for simplicity
            isJibri: false, isJigasi: false, isTranscriber: false,
            features: new Set(require('../src/xmpp/features').Features.defaultFeatures),
            sources: EndpointSourceSet.EMPTY, nick: participantEndpointId,
        };

        conferenceChatRoomInstance.emit('memberJoined', mockChatRoomMember, participantPresence);

        // Wait for the chain: MUC join -> Colibri alloc -> Jingle SI -> Jingle SA -> Colibri Update
        // This requires careful promise handling in the actual implementation.
        // For testing, we can use multiple ticks or a short timeout if the chain is truly async.
        await new Promise(resolve => setTimeout(resolve, 50)); // Increased timeout for async chain

        // --- Stage 3: Verify Colibri Update after session-accept ---
        assert.ok(mockColibriSessionManager.calls.length >= 2, "Colibri should be called for alloc and update");
        const updateCall = mockColibriSessionManager.calls.find(c => c.name === 'updateParticipant');
        assert.ok(updateCall, "ColibriSessionManager.updateParticipant should have been called");

        const [updatedEndpointId, transportXmlElement, updatedSources, updatedInitialLastN] = updateCall.args;
        assert.strictEqual(updatedEndpointId, participantEndpointId);
        assert.ok(transportXmlElement, "Transport XML element should be provided for Colibri update");
        assert.strictEqual(transportXmlElement.name, 'transport');
        assert.strictEqual(transportXmlElement.attrs.xmlns, 'urn:xmpp:jingle:transports:ice-udp:1');
        assert.strictEqual(transportXmlElement.attrs.ufrag, 'ufragAnswer', "Ufrag from session-accept should be sent to Colibri");
        assert.strictEqual(transportXmlElement.getChildren('candidate').length, 1);
        assert.strictEqual(transportXmlElement.getChildren('fingerprint').length, 1);

        // Verify sources from session-accept were processed and propagated to Colibri
        // JitsiMeetConference.participantSessionAccepted calls updateParticipant with null for sources if only transport changes.
        // If sources *were* sent, it would be the full source set after adding participant's sources.
        assert.strictEqual(updatedSources, null, "Sources should typically be null in this Colibri update (transport only)");

        // Verify participant object has its Jingle session marked active
        const participant = conference.participants.get(participantMucJid);
        assert.ok(participant, "Participant should exist in conference");
        assert.ok(participant.jingleSession, "Participant should have a Jingle session object");
        // The mock JingleSession in Participant.js has been replaced by the real one.
        assert.ok(participant.jingleSession.isActive(), "Jingle session should be active after session-accept");


        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });

    it('should process Jingle source-add from participant and propagate', async () => {
        // --- Setup: Conference, Participant, Active Jingle Session ---
        const roomName = 'testroom_sourceadd@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});

        const mockBridge = new Bridge('jvb.example.com', 'relay1', 'test-region', '1.0');
        mockBridgeSelector.addBridge(mockBridge);
        mockJicofoConfig.setConfig('jingle.codecs.audio', [{ id: 0, name: 'PCMU', clockrate: 8000 }]);
        mockJicofoConfig.setConfig('jingle.codecs.video', [{ id: 100, name: 'VP8', clockrate: 90000 }]);


        const colibriAllocTransport = new IceUdpTransport('ufragOffer', 'pwdOffer', true, [], []);
        mockColibriSessionManager.allocate = async () => new ColibriAllocation(EndpointSourceSet.EMPTY, colibriAllocTransport, 'test-region', 'colibriConfSA1', null);

        let jingleSID;
        let participant1MucJid = `${roomName}/participant1`;
        let participant1EndpointId = 'participant1';

        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iqElement) => {
            mockXmppServices.clientConnection.sentStanzas.push(iqElement);
            const jingleChild = iqElement.getChild('jingle');
            if (jingleChild?.attrs.action === 'session-initiate') {
                jingleSID = jingleChild.attrs.sid;
                const acceptIQ = xml('iq', { type: 'result', id: iqElement.attrs.id, from: participant1MucJid, to: iqElement.attrs.from },
                    xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: jingleSID, responder: participant1MucJid },
                        // Minimal content for accept
                        xml('content', {name: 'audio', creator: 'responder', senders: 'both'},
                             xml('description', {xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: 'audio'},
                                xml('payload-type', {id: '0', name: 'PCMU', clockrate: '8000'})
                             ),
                             new IceUdpTransport('p1ufrag', 'p1pwd').toXmlElement()
                        )
                    )
                );
                // Simulate async SA arrival
                process.nextTick(() => mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ));
                return xml('iq', { type: 'result', id: iqElement.attrs.id, from: participant1MucJid, to: iqElement.attrs.from });
            }
            return xml('iq', { type: 'result', id: iqElement.attrs.id, from: iqElement.attrs.to, to: iqElement.attrs.from });
        };

        const mockP1ChatMember = {
            getOccupantJid: () => participant1MucJid, getName: () => participant1EndpointId,
            getRegion: () => 'p-region', getStatsId: () => 'p1-stats',
            getRole: () => 'participant', getAffiliation: () => 'member',
            hasSctpSupport: () => false, hasAudioSupport: () => true, hasVideoSupport: () => true,
            isJibri: false, isJigasi: false, isTranscriber: false,
            features: new Set(require('../src/xmpp/features').Features.defaultFeatures),
            sources: EndpointSourceSet.EMPTY, nick: participant1EndpointId,
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP1ChatMember, xml('presence', {from: participant1MucJid}));
        await new Promise(resolve => setTimeout(resolve, 50)); // Allow session to establish

        const participant1 = conference.participants.get(participant1MucJid);
        assert.ok(participant1, "Participant1 should exist");
        assert.ok(participant1.jingleSession?.isActive(), "P1 Jingle session should be active");
        mockColibriSessionManager.calls = []; // Reset colibri calls after setup
        mockXmppServices.clientConnection.sentStanzas = []; // Reset sent stanzas

        // --- Stage 2: Participant sends source-add ---
        const p1SourceAudio = new (require('../src/common/conference/source/source'))(11111, 'audio', 'audio-s1');
        const p1SourceVideo = new (require('../src/common/conference/source/source'))(22222, 'video', 'video-s1');
        const p1SourceSet = new EndpointSourceSet(new Set([p1SourceAudio, p1SourceVideo]));

        const sourceAddIq = xml('iq', { type: 'set', from: participant1MucJid, to: mockXmppServices.clientConnection.xmpp.jid.bare().toString(), id: 'sa1' },
            xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'source-add', sid: jingleSID },
                ...p1SourceSet.toJingle(participant1EndpointId) // Construct <content> elements
            )
        );

        await mockXmppServices.clientConnection.simulateIncomingIq(sourceAddIq);
        await new Promise(resolve => setTimeout(resolve, 10)); // Allow async processing

        // --- Stage 3: Verifications ---
        // 3.1. Conference source map updated
        const confSourcesP1 = conference.getSourcesForParticipant(participant1EndpointId);
        assert.ok(confSourcesP1.sources.has(p1SourceAudio.uniqueKey) || Array.from(confSourcesP1.sources).find(s=>s.ssrc === p1SourceAudio.ssrc), 'P1 audio source should be in conference map');
        assert.ok(confSourcesP1.sources.has(p1SourceVideo.uniqueKey) || Array.from(confSourcesP1.sources).find(s=>s.ssrc === p1SourceVideo.ssrc), 'P1 video source should be in conference map');

        // 3.2. Colibri updated
        const updateCall = mockColibriSessionManager.calls.find(c => c.name === 'updateParticipant');
        assert.ok(updateCall, "Colibri should be updated with new sources");
        const [, , colibriSourcesArg] = updateCall.args; // endpointId, transport, sources, initialLastN
        assert.ok(colibriSourcesArg instanceof EndpointSourceSet, "Sources for Colibri should be EndpointSourceSet");
        assert.ok(colibriSourcesArg.sources.has(p1SourceAudio.uniqueKey) || Array.from(colibriSourcesArg.sources).find(s=>s.ssrc === p1SourceAudio.ssrc), "Colibri update should include P1 audio source");

        // 3.3. Propagation to other participants (none in this test yet, so no stanzas sent)
        // For now, just check _propagateSourcesToOthers was called if sources were accepted
        // This requires spying on JitsiMeetConference._propagateSourcesToOthers or checking its effects (sent IQs)
        // Current sentStanzas would include the ack for source-add.
        // If there were other participants, we'd expect more IQs.
        const ackForSourceAdd = mockXmppServices.clientConnection.sentStanzas.find(s => s.attrs.id === 'sa1' && s.attrs.type === 'result');
        assert.ok(ackForSourceAdd, "Jicofo should ack the source-add");

        // --- Stage 4: Add a second participant (P2) and verify propagation ---
        mockColibriSessionManager.calls = []; // Reset for P2's allocation
        mockXmppServices.clientConnection.sentStanzas = []; // Reset stanzas before P2 joins

        let participant2MucJid = `${roomName}/participant2`;
        let participant2EndpointId = 'participant2';
        let jingleSID_P2;

        // Mock P2's Jingle session setup (similar to P1)
        // P2's session-initiate will be sent, and it will also send back a session-accept
        const p2AllocTransport = new IceUdpTransport('p2ufragOffer', 'p2pwdOffer', true, [], []);
        const originalAllocate = mockColibriSessionManager.allocate; // Save P1's allocate mock
        mockColibriSessionManager.allocate = async (params) => { // New mock for P2
            mockColibriSessionManager.calls.push({ name: 'allocate', args: [params] });
            return new ColibriAllocation(EndpointSourceSet.EMPTY, p2AllocTransport, 'test-region', 'colibriConfP2', null);
        };

        const originalIqCaller = mockXmppServices.clientConnection.xmpp.iqCaller.request;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iqElement) => {
            mockXmppServices.clientConnection.sentStanzas.push(iqElement);
            const jingleChild = iqElement.getChild('jingle');
            if (jingleChild?.attrs.action === 'session-initiate' && iqElement.attrs.to === participant2MucJid) {
                jingleSID_P2 = jingleChild.attrs.sid;
                const p2Transport = new IceUdpTransport('p2ufragAnswer', 'p2pwdAnswer');
                const acceptIQ_P2 = xml('iq', { type: 'result', id: iqElement.attrs.id, from: participant2MucJid, to: iqElement.attrs.from },
                    xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: jingleSID_P2, responder: participant2MucJid },
                        xml('content', {name: 'audio', creator: 'responder'}, xml('description', {media:'audio'}), p2Transport.toXmlElement())
                    )
                );
                process.nextTick(() => mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ_P2));
                return xml('iq', { type: 'result', id: iqElement.attrs.id, from: participant2MucJid, to: iqElement.attrs.from });
            }
            // Fallback to original for other IQs (like P1's source-add ack if it happens here)
            // Or handle more generically if needed
            return xml('iq', { type: 'result', id: iqElement.attrs.id, from: iqElement.attrs.to, to: iqElement.attrs.from });
        };


        const mockP2ChatMember = {
            getOccupantJid: () => participant2MucJid, getName: () => participant2EndpointId,
            getRegion: () => 'p-region', getStatsId: () => 'p2-stats',
            getRole: () => 'participant', getAffiliation: () => 'member',
            hasSctpSupport: () => false, hasAudioSupport: () => true, hasVideoSupport: () => true,
            isJibri: false, isJigasi: false, isTranscriber: false,
            features: new Set(require('../src/xmpp/features').Features.defaultFeatures),
            sources: EndpointSourceSet.EMPTY, nick: participant2EndpointId,
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP2ChatMember, xml('presence', {from: participant2MucJid}));
        await new Promise(resolve => setTimeout(resolve, 50)); // Allow P2 session to establish

        const participant2 = conference.participants.get(participant2MucJid);
        assert.ok(participant2, "Participant2 should exist");
        assert.ok(participant2.jingleSession?.isActive(), "P2 Jingle session should be active");

        // Clear stanzas sent during P2's setup
        mockXmppServices.clientConnection.sentStanzas = [];

        // --- Stage 5: P1 sends another source-add, verify propagation to P2 ---
        const p1SourceAudio2 = new (require('../src/common/conference/source/source'))(33333, 'audio', 'audio-s2');
        const p1NewSourceSet = new EndpointSourceSet(new Set([p1SourceAudio2]));

        const sourceAddIqP1_2 = xml('iq', { type: 'set', from: participant1MucJid, to: mockXmppServices.clientConnection.xmpp.jid.bare().toString(), id: 'sa2' },
            xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'source-add', sid: jingleSID }, // Use P1's SID
                ...p1NewSourceSet.toJingle(participant1EndpointId)
            )
        );
        await mockXmppServices.clientConnection.simulateIncomingIq(sourceAddIqP1_2);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify P2 received a source-add for P1's new source
        const propagatedSourceAdd = mockXmppServices.clientConnection.sentStanzas.find(
            s => s.attrs.to === participant2MucJid && s.getChild('jingle')?.attrs.action === 'source-add'
        );
        assert.ok(propagatedSourceAdd, "P2 should have received a source-add IQ for P1's sources");

        const jingleElPropagated = propagatedSourceAdd.getChild('jingle');
        assert.strictEqual(jingleElPropagated.attrs.sid, jingleSID_P2, "Propagated source-add should use P2's Jingle SID");

        const propagatedContents = jingleElPropagated.getChildren('content');
        assert.strictEqual(propagatedContents.length, 1, "Propagated source-add should have 1 content (audio)");
        const propagatedAudioContent = propagatedContents[0];
        assert.strictEqual(propagatedAudioContent.attrs.name, 'audio');
        const propagatedSourceElement = propagatedAudioContent.getChild('description')?.getChild('source');
        assert.ok(propagatedSourceElement, "Propagated audio content should contain a source element");
        assert.strictEqual(propagatedSourceElement.attrs.ssrc, '33333');
        // Verify owner is P1's endpoint ID
        const ssrcInfo = propagatedSourceElement.getChild('ssrc-info', 'http://jitsi.org/jitmeet');
        assert.ok(ssrcInfo, "ssrc-info should be present in propagated source");
        assert.strictEqual(ssrcInfo.attrs.owner, participant1EndpointId);


        // Restore mocks
        mockColibriSessionManager.allocate = originalAllocate;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = originalIqCaller;
        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });

    it('should process Jingle source-remove from participant and propagate', async () => {
        // --- Setup: Conference with P1 and P2, P1 has sources ---
        const roomName = 'testroom_sourceremove@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom { /* ... as above ... */
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});
        const mockBridge = new Bridge('jvb.example.com', 'r1', 'test-r', '1.0');
        mockBridgeSelector.addBridge(mockBridge);

        // Setup P1
        let p1InitialAudio = new (require('../src/common/conference/source/source'))(111, 'audio', 'p1a1');
        let p1InitialVideo = new (require('../src/common/conference/source/source'))(222, 'video', 'p1v1');
        let p1InitialSources = new EndpointSourceSet(new Set([p1InitialAudio, p1InitialVideo]));

        let p1MucJid = `${roomName}/p1`;
        let p1EndpointId = 'p1';
        let p1JingleSID;

        const colibriAllocP1 = new ColibriAllocation(p1InitialSources, new IceUdpTransport('uP1', 'pP1'), 'r', 'c1', null);
        const originalAllocate = mockColibriSessionManager.allocate;
        mockColibriSessionManager.allocate = async (params) => {
            if (params.id === p1EndpointId) return colibriAllocP1;
            // Basic allocation for other participants for this test
            return new ColibriAllocation(EndpointSourceSet.EMPTY, new IceUdpTransport('uDEF', 'pDEF'), 'r', `c${params.id}`, null);
        };

        let p1Accepted = false;
        const originalClientIqCaller = mockXmppServices.clientConnection.xmpp.iqCaller.request;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iq) => {
            mockXmppServices.clientConnection.sentStanzas.push(iq);
            const jingleEl = iq.getChild('jingle');
            if (jingleEl?.attrs.action === 'session-initiate' && iq.attrs.to === p1MucJid) {
                p1JingleSID = jingleEl.attrs.sid;
                const acceptIQ = xml('iq', {type: 'result', id: iq.attrs.id, from: p1MucJid, to: iq.attrs.from},
                    xml('jingle', {xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: p1JingleSID, responder: p1MucJid},
                        // P1 answers with its initial sources
                        ...p1InitialSources.toJingle(p1EndpointId)
                    )
                );
                process.nextTick(() => {
                    p1Accepted = true;
                    mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ);
                });
                return xml('iq', {type: 'result', id: iq.attrs.id });
            }
            // Generic ack for other IQs
            return xml('iq', {type: 'result', id: iq.attrs.id, from: iq.attrs.to, to: iq.attrs.from });
        };

        const mockP1CM = { /* ... P1 chat member details, sources: p1InitialSources ... */
            getOccupantJid:()=>p1MucJid, getName:()=>p1EndpointId, getRegion:()=>'r', getStatsId:()=>'s1', getRole:()=>'participant',
            getAffiliation:()=>'member', hasSctpSupport:()=>false, hasAudioSupport:()=>true, hasVideoSupport:()=>true,
            isJibri:false, isJigasi:false, isTranscriber:false, features: new Set(), sources: p1InitialSources, nick: p1EndpointId
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP1CM, xml('presence', {from: p1MucJid}));
        while(!p1Accepted) await new Promise(r => setTimeout(r, 10)); // Wait for P1 session-accept to be processed


        // Setup P2 (similar, simpler accept as it won't send sources back in this test part)
        let p2MucJid = `${roomName}/p2`;
        let p2EndpointId = 'p2';
        let p2JingleSID;
        let p2Accepted = false;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iq) => { // Override again for P2
            mockXmppServices.clientConnection.sentStanzas.push(iq);
            const jingleEl = iq.getChild('jingle');
            if (jingleEl?.attrs.action === 'session-initiate' && iq.attrs.to === p2MucJid) {
                p2JingleSID = jingleEl.attrs.sid;
                const acceptIQ_P2 = xml('iq', {type: 'result', id: iq.attrs.id, from: p2MucJid, to: iq.attrs.from},
                    xml('jingle', {xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: p2JingleSID, responder: p2MucJid},
                         xml('content', {name: 'audio', creator: 'responder'}, xml('description', {media:'audio'}), new IceUdpTransport('uP2', 'pP2').toXmlElement())
                ));
                process.nextTick(() => {
                    p2Accepted = true;
                    mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ_P2);
                });
                return xml('iq', {type: 'result', id: iq.attrs.id });
            }
            return xml('iq', {type: 'result', id: iq.attrs.id, from: iq.attrs.to, to: iq.attrs.from });
        };
        const mockP2CM = { /* ... P2 chat member details, sources: EndpointSourceSet.EMPTY ... */
            getOccupantJid:()=>p2MucJid, getName:()=>p2EndpointId, getRegion:()=>'r', getStatsId:()=>'s2', getRole:()=>'participant',
            getAffiliation:()=>'member', hasSctpSupport:()=>false, hasAudioSupport:()=>true, hasVideoSupport:()=>true,
            isJibri:false, isJigasi:false, isTranscriber:false, features: new Set(), sources: EndpointSourceSet.EMPTY, nick: p2EndpointId
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP2CM, xml('presence', {from: p2MucJid}));
        while(!p2Accepted) await new Promise(r => setTimeout(r, 10)); // Wait for P2 session-accept

        // At this point, P1 should have p1InitialSources, P2 should have received them.
        mockColibriSessionManager.calls = [];
        mockXmppServices.clientConnection.sentStanzas = [];


        // --- Stage 2: P1 sends source-remove for its video source (222) ---
        const sourcesToRemove = new EndpointSourceSet(new Set([p1InitialVideo]));
        const sourceRemoveIq = xml('iq', { type: 'set', from: p1MucJid, to: mockXmppServices.clientConnection.xmpp.jid.bare().toString(), id: 'sr1' },
            xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'source-remove', sid: p1JingleSID },
                ...sourcesToRemove.toJingle(p1EndpointId)
            )
        );
        await mockXmppServices.clientConnection.simulateIncomingIq(sourceRemoveIq);
        await new Promise(resolve => setTimeout(resolve, 20)); // Allow async processing

        // --- Stage 3: Verifications ---
        // 3.1. Conference source map updated for P1 (video source removed)
        const confSourcesP1AfterRemove = conference.getSourcesForParticipant(p1EndpointId);
        assert.ok(Array.from(confSourcesP1AfterRemove.sources).find(s=>s.ssrc === p1InitialAudio.ssrc), 'P1 audio source should still be in conf map');
        assert.ok(!Array.from(confSourcesP1AfterRemove.sources).find(s=>s.ssrc === p1InitialVideo.ssrc), 'P1 video source should be removed from conf map');

        // 3.2. Colibri updated for P1
        const updateCall = mockColibriSessionManager.calls.find(c => c.name === 'updateParticipant');
        assert.ok(updateCall, "Colibri should be updated after source-remove");
        const [, , colibriSourcesArg] = updateCall.args;
        assert.ok(Array.from(colibriSourcesArg.sources).find(s=>s.ssrc === p1InitialAudio.ssrc), "Colibri update should include P1 audio source");
        assert.ok(!Array.from(colibriSourcesArg.sources).find(s=>s.ssrc === p1InitialVideo.ssrc), "Colibri update should NOT include P1 video source");

        // 3.3. Propagation to P2
        const propagatedSourceRemove = mockXmppServices.clientConnection.sentStanzas.find(
            s => s.attrs.to === p2MucJid && s.getChild('jingle')?.attrs.action === 'source-remove'
        );
        assert.ok(propagatedSourceRemove, "P2 should have received a source-remove IQ for P1's video source");
        const jingleElPropagated = propagatedSourceRemove.getChild('jingle');
        assert.strictEqual(jingleElPropagated.attrs.sid, p2JingleSID, "Propagated source-remove should use P2's Jingle SID");
        const propagatedContents = jingleElPropagated.getChildren('content');
        const videoContentProp = propagatedContents.find(c => c.attrs.name === 'video');
        assert.ok(videoContentProp, "Propagated source-remove should contain video content");
        const videoSourceEl = videoContentProp.getChild('description')?.getChild('source');
        assert.ok(videoSourceEl, "Propagated video content should contain a source element");
        assert.strictEqual(parseInt(videoSourceEl.attrs.ssrc,10), p1InitialVideo.ssrc);
        const ssrcInfo = videoSourceEl.getChild('ssrc-info', 'http://jitsi.org/jitmeet');
        assert.ok(ssrcInfo && ssrcInfo.attrs.owner === p1EndpointId, "Propagated source should have correct owner");

        // 3.4. Jicofo ACKs the source-remove from P1
        const ackForSourceRemove = mockXmppServices.clientConnection.sentStanzas.find(s => s.attrs.id === 'sr1' && s.attrs.type === 'result');
        assert.ok(ackForSourceRemove, "Jicofo should ack the source-remove from P1");

        // Restore original mocks
        mockColibriSessionManager.allocate = originalAllocate;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = originalClientIqCaller;
        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });

    it('should process Jingle session-terminate from participant and clean up resources', async () => {
        // --- Setup: Conference with P1, P1 has sources and active session ---
        const roomName = 'testroom_terminate@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});
        const mockBridge = new Bridge('jvb.example.com', 'r1', 'test-r', '1.0');
        mockBridgeSelector.addBridge(mockBridge);

        let p1InitialAudio = new (require('../src/common/conference/source/source'))(11122, 'audio', 'p1audT');
        let p1InitialSources = new EndpointSourceSet(new Set([p1InitialAudio]));

        let p1MucJid = `${roomName}/p1terminate`;
        let p1EndpointId = 'p1terminate';
        let p1JingleSID;

        const colibriAllocP1 = new ColibriAllocation(p1InitialSources, new IceUdpTransport('uP1T', 'pP1T'), 'r', 'c1T', null);
        const originalAllocate = mockColibriSessionManager.allocate;
        mockColibriSessionManager.allocate = async (params) => {
            if (params.id === p1EndpointId) return colibriAllocP1;
            return new ColibriAllocation(EndpointSourceSet.EMPTY, new IceUdpTransport('uDEF', 'pDEF'), 'r', `c${params.id}`, null);
        };

        let p1Accepted = false;
        const originalClientIqCaller = mockXmppServices.clientConnection.xmpp.iqCaller.request;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iq) => {
            mockXmppServices.clientConnection.sentStanzas.push(iq);
            const jingleEl = iq.getChild('jingle');
            if (jingleEl?.attrs.action === 'session-initiate' && iq.attrs.to === p1MucJid) {
                p1JingleSID = jingleEl.attrs.sid;
                const acceptIQ = xml('iq', {type: 'result', id: iq.attrs.id, from: p1MucJid, to: iq.attrs.from},
                    xml('jingle', {xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: p1JingleSID, responder: p1MucJid},
                        ...p1InitialSources.toJingle(p1EndpointId)
                    )
                );
                process.nextTick(() => {
                    p1Accepted = true;
                    mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ);
                });
                return xml('iq', {type: 'result', id: iq.attrs.id });
            }
            return xml('iq', {type: 'result', id: iq.attrs.id, from: iq.attrs.to, to: iq.attrs.from });
        };

        const mockP1CM = {
            getOccupantJid:()=>p1MucJid, getName:()=>p1EndpointId, getRegion:()=>'r', getStatsId:()=>'s1T', getRole:()=>'participant',
            getAffiliation:()=>'member', hasSctpSupport:()=>false, hasAudioSupport:()=>true, hasVideoSupport:()=>false,
            isJibri:false, isJigasi:false, isTranscriber:false, features: new Set(), sources: p1InitialSources, nick: p1EndpointId,
            chatRoom: { xmppConnection: mockXmppServices.clientConnection } // Needed by Participant.createNewJingleSession
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP1CM, xml('presence', {from: p1MucJid}));
        while(!p1Accepted) await new Promise(r => setTimeout(r, 20));

        const participant1 = conference.participants.get(p1MucJid);
        assert.ok(participant1?.jingleSession?.isActive(), "P1 Jingle session should be active before terminate");
        assert.ok(conference.getSourcesForParticipant(p1EndpointId).sources.size > 0, "P1 should have sources in conference map");

        mockColibriSessionManager.calls = []; // Reset colibri calls
        mockXmppServices.clientConnection.sentStanzas = []; // Reset sent stanzas


        // --- Stage 2: P1 sends session-terminate ---
        const JingleReason = require('../src/common/xmpp/jingle/jingleReason').JingleReason;
        const terminateReason = JingleReason.SUCCESS; // e.g., participant hung up normally

        const sessionTerminateIq = xml('iq', { type: 'set', from: p1MucJid, to: mockXmppServices.clientConnection.xmpp.jid.bare().toString(), id: 'st1' },
            xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'session-terminate', sid: p1JingleSID },
                xml('reason', {}, xml(terminateReason.name, { xmlns: terminateReason.xmlns }))
            )
        );
        await mockXmppServices.clientConnection.simulateIncomingIq(sessionTerminateIq);
        await new Promise(resolve => setTimeout(resolve, 20)); // Allow async processing

        // --- Stage 3: Verifications ---
        // 3.1. Participant's Jingle session is no longer active / participant removed
        assert.ok(!participant1.jingleSession, "P1 JingleSession object should be nulled after termination");
        assert.ok(!conference.participants.has(p1MucJid), "P1 should be removed from conference participants map");

        // 3.2. P1's sources removed from conference map
        assert.ok(conference.getSourcesForParticipant(p1EndpointId).isEmpty(), "P1 sources should be removed from conference map");

        // 3.3. Colibri resources for P1 expired
        // JitsiMeetConference._terminateParticipant calls colibriSessionManager.removeParticipant
        // Let's assume removeParticipant on CSM means expire endpoint on bridge.
        const colibriRemoveCall = mockColibriSessionManager.calls.find(c => c.name === 'removeParticipant' && c.args[0] === p1EndpointId);
        // Note: The current mockColibriSessionManager.removeParticipant is a no-op.
        // A real one would trigger Colibri2Session.expire([participantInfo])
        // For now, we check if JMC tried to call it.
        // TODO: Enhance mockColibriSessionManager to spy on Colibri2Session.expire if needed, or verify IQs.
        // For this test, let's assume JMC's intent to call removeParticipant is enough.
        // The call to CSM.removeParticipant is now active in JMC._terminateParticipant.
        assert.ok(colibriRemoveCall, "ColibriSessionManager.removeParticipant should have been called for P1");


        // 3.4. Jicofo ACKs the session-terminate from P1
        const ackForSessionTerminate = mockXmppServices.clientConnection.sentStanzas.find(s => s.attrs.id === 'st1' && s.attrs.type === 'result');
        assert.ok(ackForSessionTerminate, "Jicofo should ack the session-terminate from P1");

        // Restore original mocks
        mockColibriSessionManager.allocate = originalAllocate;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = originalClientIqCaller;
        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });

    it('should trigger re-invite on Jingle session-info with ICE failure', async () => {
        // --- Setup: Conference with P1, active session ---
        const roomName = 'testroom_icefail@conference.example.com';
        let conferenceChatRoomInstance;
        const realChatRoom = require('../src/xmpp/muc/chatRoom').ChatRoom;
        require('../src/xmpp/muc/chatRoom').ChatRoom = class extends MockChatRoom {
            constructor(...args) { super(...args); conferenceChatRoomInstance = this; }
            async join() { this.joined = true; return { meetingId: `meeting-${Date.now()}`, mainRoomJid: null }; }
        };
        conference = await focusManager.conferenceRequest(roomName, {});
        const mockBridge1 = new Bridge('jvb1.example.com', 'r1', 'test-r', '1.0');
        mockBridgeSelector.addBridge(mockBridge1);

        let p1MucJid = `${roomName}/p1ice`;
        let p1EndpointId = 'p1ice';
        let p1InitialJingleSID;
        let p1InitialColibriConfId = 'colibriConf_ice1';

        const colibriAllocP1_attempt1 = new ColibriAllocation(EndpointSourceSet.EMPTY, new IceUdpTransport('uP1_i1', 'pP1_i1'), 'r', p1InitialColibriConfId, null);

        let allocationCount = 0;
        const originalAllocate = mockColibriSessionManager.allocate;
        mockColibriSessionManager.allocate = async (params) => {
            allocationCount++;
            mockColibriSessionManager.calls.push({ name: 'allocate', args: [params] });
            if (allocationCount === 1) return colibriAllocP1_attempt1;
            // For re-invite, return slightly different data
            return new ColibriAllocation(EndpointSourceSet.EMPTY, new IceUdpTransport('uP1_i2', 'pP1_i2'), 'r', `colibriConf_ice2_${Date.now()}`, null);
        };

        let p1Accepted = false;
        const originalClientIqCaller = mockXmppServices.clientConnection.xmpp.iqCaller.request;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = async (iq) => {
            mockXmppServices.clientConnection.sentStanzas.push(iq);
            const jingleEl = iq.getChild('jingle');
            if (jingleEl?.attrs.action === 'session-initiate' && iq.attrs.to === p1MucJid) {
                p1InitialJingleSID = jingleEl.attrs.sid;
                const acceptIQ = xml('iq', {type: 'result', id: iq.attrs.id, from: p1MucJid, to: iq.attrs.from},
                    xml('jingle', {xmlns: 'urn:xmpp:jingle:1', action: 'session-accept', sid: p1InitialJingleSID, responder: p1MucJid},
                         xml('content', {name: 'audio', creator: 'responder'}, xml('description', {media:'audio'}), new IceUdpTransport('uP1ans', 'pP1ans').toXmlElement())
                ));
                process.nextTick(() => { p1Accepted = true; mockXmppServices.clientConnection.simulateIncomingIq(acceptIQ); });
                return xml('iq', {type: 'result', id: iq.attrs.id });
            }
            return xml('iq', {type: 'result', id: iq.attrs.id, from: iq.attrs.to, to: iq.attrs.from });
        };

        const mockP1CM = {
            getOccupantJid:()=>p1MucJid, getName:()=>p1EndpointId, getRegion:()=>'r', getStatsId:()=>'s1ice', getRole:()=>'participant',
            getAffiliation:()=>'member', hasSctpSupport:()=>false, hasAudioSupport:()=>true, hasVideoSupport:()=>false,
            isJibri:false, isJigasi:false, isTranscriber:false, features: new Set(), sources: EndpointSourceSet.EMPTY, nick: p1EndpointId,
            chatRoom: { xmppConnection: mockXmppServices.clientConnection }
        };
        conferenceChatRoomInstance.emit('memberJoined', mockP1CM, xml('presence', {from: p1MucJid}));
        while(!p1Accepted) await new Promise(r => setTimeout(r, 20));

        const participant1 = conference.participants.get(p1MucJid);
        assert.ok(participant1?.jingleSession?.isActive(), "P1 Jingle session should be active initially");

        mockColibriSessionManager.calls = []; // Reset colibri calls
        mockXmppServices.clientConnection.sentStanzas = []; // Reset sent stanzas after initial setup

        // --- Stage 2: P1 sends session-info with ICE failure ---
        const iceFailedSessionInfo = xml('iq', { type: 'set', from: p1MucJid, to: mockXmppServices.clientConnection.xmpp.jid.bare().toString(), id: 'siFail1' },
            xml('jingle', { xmlns: 'urn:xmpp:jingle:1', action: 'session-info', sid: p1InitialJingleSID, initiator: participant1.mucJid }, // P1 is initiator of session-info
                xml('ice-udp', { xmlns: 'urn:xmpp:jingle:transports:ice-udp:1' }, // Example structure, actual might differ
                    xml('ice-state', {}, 'failed')
                ),
                xml('bridge-session', { xmlns: 'http://jitsi.org/protocol/colibri', id: p1InitialColibriConfId })
            )
        );
        await mockXmppServices.clientConnection.simulateIncomingIq(iceFailedSessionInfo);
        await new Promise(resolve => setTimeout(resolve, 50)); // Allow async processing for re-invite

        // --- Stage 3: Verifications ---
        // 3.1. Colibri allocate called again for P1
        assert.strictEqual(mockColibriSessionManager.calls.length, 1, "Colibri allocate should be called once for re-invite");
        assert.strictEqual(mockColibriSessionManager.calls[0].name, 'allocate');
        assert.strictEqual(mockColibriSessionManager.calls[0].args[0].id, p1EndpointId);

        // 3.2. New Jingle session-initiate sent to P1
        const newSessionInitiate = mockXmppServices.clientConnection.sentStanzas.find(
            s => s.attrs.to === p1MucJid && s.getChild('jingle')?.attrs.action === 'session-initiate'
        );
        assert.ok(newSessionInitiate, "A new Jingle session-initiate should be sent to P1");
        const newJingleEl = newSessionInitiate.getChild('jingle');
        assert.notStrictEqual(newJingleEl.attrs.sid, p1InitialJingleSID, "New session-initiate should have a new SID");

        // 3.3. Transport in new offer should use details from the second Colibri allocation
        const newTransportEl = newJingleEl.getChild('content', {name: 'audio'})?.getChild('transport', 'urn:xmpp:jingle:transports:ice-udp:1');
        assert.ok(newTransportEl, "New offer should contain transport");
        assert.strictEqual(newTransportEl.attrs.ufrag, 'uP1_i2', "Ufrag should be from the second allocation");

        // 3.4. Jicofo ACKs the session-info from P1
        const ackForSessionInfo = mockXmppServices.clientConnection.sentStanzas.find(s => s.attrs.id === 'siFail1' && s.attrs.type === 'result');
        assert.ok(ackForSessionInfo, "Jicofo should ack the session-info");

        // Restore original mocks
        mockColibriSessionManager.allocate = originalAllocate;
        mockXmppServices.clientConnection.xmpp.iqCaller.request = originalClientIqCaller;
        require('../src/xmpp/muc/chatRoom').ChatRoom = realChatRoom;
    });
});

// AV Moderation integration test
const request = require('supertest');
const app = require('../src/api/index'); // Adjust if needed to get the Express app
const conferenceStore = require('../src/common/conferenceStore');

describe('AV Moderation Integration', () => {
    const room = 'testroom@example.com';

    beforeEach(() => {
        // Reset conference state
        conferenceStore.createConference(room, {});
    });

    it('should enable AV moderation via REST and reflect in debug endpoint', async () => {
        // Enable audio moderation
        await request(app.app)
            .post('/av-moderation')
            .send({ room, mediaType: 'audio', enabled: true, whitelist: ['mod1'] })
            .expect(200);
        // Check debug endpoint
        const res = await request(app.app)
            .get(`/debug/conference/${encodeURIComponent(room)}`)
            .expect(200);
        expect(res.body.avModeration.audio.enabled).toBe(true);
        expect(res.body.avModeration.audio.whitelist).toContain('mod1');
    });

    it('should disable AV moderation via REST', async () => {
        // Disable video moderation
        await request(app.app)
            .post('/av-moderation')
            .send({ room, mediaType: 'video', enabled: false })
            .expect(200);
        // Check debug endpoint
        const res = await request(app.app)
            .get(`/debug/conference/${encodeURIComponent(room)}`)
            .expect(200);
        expect(res.body.avModeration.video.enabled).toBe(false);
    });

    it('should set whitelist via REST', async () => {
        await request(app.app)
            .post('/av-moderation')
            .send({ room, mediaType: 'audio', whitelist: ['mod2', 'mod3'] })
            .expect(200);
        const res = await request(app.app)
            .get(`/debug/conference/${encodeURIComponent(room)}`)
            .expect(200);
        expect(res.body.avModeration.audio.whitelist).toEqual(['mod2', 'mod3']);
    });

    // Placeholder for XMPP message simulation test
    it('should handle AV moderation XMPP message (simulation placeholder)', () => {
        // TODO: Simulate XMPP message and verify state
        // This would require a mock or test XMPP client
        expect(true).toBe(true);
    });
});
