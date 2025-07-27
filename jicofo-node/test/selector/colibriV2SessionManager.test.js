const { expect } = require('chai');
const ColibriV2SessionManager = require('../../src/selector/bridge/colibri/colibriV2SessionManager');
const Colibri2Session = require('../../src/selector/bridge/colibri/colibri2Session');

global.parseConferenceModifyResponse = () => ({
  conferenceId: 'conf-123',
  endpointFeedbackSources: {},
  endpointTransport: {},
  endpointSctpPort: 5000,
  region: 'us-east',
  sessionId: 'session-123',
  success: true
});

describe('ColibriV2SessionManager', () => {
    let manager;
    let xmppConnection;
    let bridgeSelector;
    let logger;

    beforeEach(() => {
        xmppConnection = {};
        bridgeSelector = {
            selectBridge: () => ({ 
                relayId: 'relay-1', 
                getJid: () => 'bridge@jvb', 
                getRelayId: () => 'relay-1',
                isOperational: true 
            })
        };
        logger = { info: () => {}, debug: () => {}, error: () => {}, child: () => logger };
        manager = new ColibriV2SessionManager(
            xmppConnection,
            bridgeSelector,
            'room@conference',
            'meeting-123',
            false,
            null,
            logger
        );
    });

    it('should allocate a participant and create a session', async () => {
        const participantInfo = { 
            id: 'p1', 
            region: 'us-east', 
            visitor: false, 
            hasAudioSources: () => true,
            hasVideoSources: () => false,
            useSctp: false,
            statsId: 'stats1',
            displayName: 'Test User',
            sources: []
        };
        
        // Mock the session creation and allocation
        manager._getOrCreateSession = (bridge, visitor) => {
            const session = new Colibri2Session(manager, bridge, visitor, logger);
            // Mock the sendAllocationRequest method
            session.sendAllocationRequest = async (participantInfo) => {
                // Create a proper mock response object
                return { 
                    type: 'result',
                    attrs: { type: 'result' },
                    toString: () => '<iq type="result"/>'
                };
            };
            // Ensure session is added to manager's sessions map
            manager.sessions.set(bridge.getRelayId(), session);
            return { session, created: true };
        };
        
        manager._addParticipantInfo = (participantInfo) => {
            manager.participants.set(participantInfo.id, participantInfo);
        };
        manager.emit = () => {};
        
        const response = await manager.allocate(participantInfo);
        console.log('Response object:', response);
        console.log('Response keys:', Object.keys(response));
        expect(response).to.exist;
        expect(response.bridgeSessionId).to.equal('conf-123');
    });

    it('should expire all sessions and clear state', async () => {
        const session = new Colibri2Session(manager, { 
            relayId: 'relay-1',
            getJid: () => 'bridge@jvb',
            getRelayId: () => 'relay-1',
            relays: new Map()
        }, false, logger);
        manager.sessions.set('relay-1', session);
        await manager.expire();
        expect(manager.sessions.size).to.equal(0);
        expect(manager.participants.size).to.equal(0);
    });

    it('should add and remove relay links between sessions', () => {
        const s1 = new Colibri2Session(manager, { 
            relayId: 'relay-1',
            getJid: () => 'bridge1@jvb',
            getRelayId: () => 'relay-1',
            relays: new Map()
        }, false, logger);
        const s2 = new Colibri2Session(manager, { 
            relayId: 'relay-2',
            getJid: () => 'bridge2@jvb',
            getRelayId: () => 'relay-2',
            relays: new Map()
        }, false, logger);
        
        // Ensure relays are initialized
        s1.relays = new Map();
        s2.relays = new Map();
        
        // Mock the createRelay and expireRelay methods
        s1.createRelay = (remoteRelayId, remoteParticipants, initiator, meshId) => {
            s1.relays.set(remoteRelayId, { meshId, initiator });
        };
        s2.createRelay = (remoteRelayId, remoteParticipants, initiator, meshId) => {
            s2.relays.set(remoteRelayId, { meshId, initiator });
        };
        s1.expireRelay = (remoteRelayId) => {
            s1.relays.delete(remoteRelayId);
        };
        s2.expireRelay = (remoteRelayId) => {
            s2.relays.delete(remoteRelayId);
        };
        
        manager.addLinkBetween(s1, s2, 'mesh-1');
        expect(s1.relays.has('relay-2')).to.be.true;
        expect(s2.relays.has('relay-1')).to.be.true;
        manager.removeLinkTo(s1, s2);
        expect(s1.relays.has('relay-2')).to.be.false;
    });
}); 
