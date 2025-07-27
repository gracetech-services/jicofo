const { expect } = require('chai');
const { xml } = require('@xmpp/client');
const { setupAuthenticationIqHandler, setupMuteIqHandlers, setupJibriIqHandler, setupJigasiIqHandler } = require('../src/xmpp/xmppServices');

describe('XMPP IQ Handlers', () => {
    let mockXmppConnection;
    let mockConferenceStore;
    let mockAuthenticationAuthority;
    let mockJigasiDetector;

    beforeEach(() => {
        // Mock XMPP connection
        mockXmppConnection = {
            registerIqHandler: sinon.stub(),
            send: sinon.stub(),
            sendIq: sinon.stub()
        };

        // Mock conference store
        mockConferenceStore = {
            getConference: sinon.stub(),
            getAllConferences: sinon.stub().returns([]),
            createConference: sinon.stub(),
            addParticipant: sinon.stub(),
            removeParticipant: sinon.stub()
        };

        // Mock authentication authority
        mockAuthenticationAuthority = {
            createLoginUrl: sinon.stub().returns('https://example.com/login'),
            processLogoutIq: sinon.stub().returns(xml('iq', { type: 'result' })),
            getSessionForJid: sinon.stub()
        };

        // Mock Jigasi detector
        mockJigasiDetector = {
            selectTranscriber: sinon.stub(),
            selectSipJigasi: sinon.stub()
        };
    });

    describe('Authentication IQ Handler', () => {
        it('should handle login URL requests correctly', async () => {
            setupAuthenticationIqHandler(mockXmppConnection, mockAuthenticationAuthority);

            expect(mockXmppConnection.registerIqHandler).to.have.been.calledWith(
                'login-url',
                'http://jitsi.org/protocol/focus',
                sinon.match.func
            );

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'get', from: 'user@example.com', id: 'test-id' },
                xml('login-url', { xmlns: 'http://jitsi.org/protocol/focus', room: 'test-room', machineUID: 'test-uid', popup: 'true' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
            expect(response.getChild('login-url')).to.exist;
        });

        it('should handle logout requests correctly', async () => {
            setupAuthenticationIqHandler(mockXmppConnection, mockAuthenticationAuthority);

            const handler = mockXmppConnection.registerIqHandler.getCall(1).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('logout', { xmlns: 'http://jitsi.org/protocol/focus' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
        });
    });

    describe('Mute IQ Handlers', () => {
        it('should handle audio mute requests correctly', async () => {
            const mockConference = {
                handleMuteRequest: sinon.stub().returns('SUCCESS')
            };
            mockConferenceStore.getConference.returns(mockConference);

            setupMuteIqHandlers(mockXmppConnection, mockConferenceStore);

            expect(mockXmppConnection.registerIqHandler).to.have.been.calledWith(
                'mute',
                'http://jitsi.org/protocol/focus',
                sinon.match.func
            );

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('mute', { xmlns: 'http://jitsi.org/protocol/focus', mute: 'true', jid: 'target@example.com' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
        });

        it('should handle video mute requests correctly', async () => {
            const mockConference = {
                handleMuteRequest: sinon.stub().returns('SUCCESS')
            };
            mockConferenceStore.getConference.returns(mockConference);

            setupMuteIqHandlers(mockXmppConnection, mockConferenceStore);

            const handler = mockXmppConnection.registerIqHandler.getCall(1).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('mute-video', { xmlns: 'http://jitsi.org/protocol/focus', mute: 'true', jid: 'target@example.com' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
        });
    });

    describe('Jibri IQ Handler', () => {
        it('should handle Jibri requests correctly', async () => {
            const mockConference = {
                handleJibriRequest: sinon.stub().returns({ accepted: true, response: xml('iq', { type: 'result' }) })
            };
            mockConferenceStore.getAllConferences.returns([mockConference]);

            setupJibriIqHandler(mockXmppConnection, mockConferenceStore);

            expect(mockXmppConnection.registerIqHandler).to.have.been.calledWith(
                'jibri',
                'http://jitsi.org/protocol/jibri',
                sinon.match.func
            );

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('jibri', { xmlns: 'http://jitsi.org/protocol/jibri', action: 'start' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
        });
    });

    describe('Jigasi IQ Handler', () => {
        it('should handle Jigasi requests correctly', async () => {
            const mockConference = {
                acceptJigasiRequest: sinon.stub().returns(true),
                roomName: 'test-room'
            };
            mockConferenceStore.getConference.returns(mockConference);

            setupJigasiIqHandler(mockXmppConnection, mockConferenceStore, mockJigasiDetector);

            expect(mockXmppConnection.registerIqHandler).to.have.been.calledWith(
                'dial',
                'urn:xmpp:rayo:1',
                sinon.match.func
            );

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('dial', { xmlns: 'urn:xmpp:rayo:1', destination: 'sip:test@example.com' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('result');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing required fields in mute requests', async () => {
            setupMuteIqHandlers(mockXmppConnection, mockConferenceStore);

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('mute', { xmlns: 'http://jitsi.org/protocol/focus' }) // Missing mute and jid
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('error');
            expect(response.getChild('error')).to.exist;
        });

        it('should handle non-existent conferences', async () => {
            mockConferenceStore.getConference.returns(null);

            setupMuteIqHandlers(mockXmppConnection, mockConferenceStore);

            const handler = mockXmppConnection.registerIqHandler.getCall(0).args[2];
            const iq = xml('iq', { type: 'set', from: 'user@example.com', id: 'test-id' },
                xml('mute', { xmlns: 'http://jitsi.org/protocol/focus', mute: 'true', jid: 'target@example.com' })
            );

            const response = await handler(iq);
            expect(response.attrs.type).to.equal('error');
            expect(response.getChild('error')).to.exist;
        });
    });
}); 