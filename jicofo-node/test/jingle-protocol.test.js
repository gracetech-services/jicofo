/*
 * Jicofo-Node, the Jitsi Conference Focus (Node.js version).
 *
 * Copyright @ 2024 - present 8x8, Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const assert = require('assert');
const { createElement } = require('@xmpp/xml');
const { JingleSession } = require('../src/common/xmpp/jingle/jingleSession');
const { JingleAction, State } = require('../src/common/xmpp/jingle/jingleConstants');
const JingleIqRequestHandler = require('../src/common/xmpp/jingle/jingleIqRequestHandler');
const { JingleRequestHandler, NoOpJingleRequestHandler } = require('../src/common/xmpp/jingle/jingleRequestHandler');
const { jingleStatsInstance } = require('../src/common/xmpp/jingle/jingleStats');
const ConferenceSourceMap = require('../src/common/conference/source/conferenceSourceMap');
const EndpointSourceSet = require('../src/common/conference/source/endpointSourceSet');
const Source = require('../src/common/conference/source/source');
const MediaType = require('../src/common/conference/source/mediaType');
const { createJingleOffer } = require('../src/common/xmpp/jingle/jingleOfferFactory');
const { defaultJingleConfig } = require('../src/config/serviceConfigs');
const { xml } = require('@xmpp/xml');

// Mock XMPP connection for testing
class MockXmppConnection {
    constructor() {
        this.sentIqs = [];
        this.mockResponses = new Map();
        this.isOnline = true;
    }

    async sendIq(iq) {
        this.sentIqs.push(iq);
        const id = iq.attrs.id;
        if (this.mockResponses.has(id)) {
            return this.mockResponses.get(id);
        }
        return createElement('iq', { type: 'result', id });
    }

    get iqCaller() {
        return {
            request: async (iq) => {
                this.sentIqs.push(iq);
                const id = iq.attrs.id;
                if (this.mockResponses.has(id)) {
                    return this.mockResponses.get(id);
                }
                return createElement('iq', { type: 'result', id });
            }
        };
    }

    registerIqHandler(elementName, namespace, handler) {
        this.iqHandler = handler;
    }

    setMockResponse(id, response) {
        this.mockResponses.set(id, response);
    }

    clearSentIqs() {
        this.sentIqs = [];
    }
}

// Mock Jingle handler
class MockJingleHandler {
    constructor(xmppConnection) {
        this.xmppConnection = xmppConnection;
        this.activeSessions = new Map();
    }

    registerSession(session) {
        this.activeSessions.set(session.sid, session);
    }

    unregisterSession(sid) {
        this.activeSessions.delete(sid);
    }

    async sendIq(iq) {
        return this.xmppConnection.sendIq(iq);
    }

    get iqCaller() {
        return this.xmppConnection.iqCaller;
    }
}

describe('Jingle Protocol Implementation', () => {
    let mockXmppConnection;
    let mockJingleHandler;
    let jingleIqRequestHandler;

    beforeEach(() => {
        mockXmppConnection = new MockXmppConnection();
        mockJingleHandler = new MockJingleHandler(mockXmppConnection);
        jingleIqRequestHandler = new JingleIqRequestHandler([mockXmppConnection]);
        jingleStatsInstance.reset();
    });

    describe('JingleSession', () => {
        let session;
        let requestHandler;

        beforeEach(() => {
            requestHandler = new NoOpJingleRequestHandler();
            session = new JingleSession(
                'test-sid-123',
                'participant@example.com/resource',
                mockJingleHandler,
                mockXmppConnection,
                requestHandler,
                false // encodeSourcesAsJson
            );
        });

        it('should create a Jingle session with correct initial state', () => {
            assert.strictEqual(session.sid, 'test-sid-123');
            assert.strictEqual(session.remoteJid, 'participant@example.com/resource');
            assert.strictEqual(session.state, State.PENDING);
            assert.strictEqual(session.isActive(), false);
        });

        it('should initiate a session successfully', async () => {
            const result = await session.initiateSession();
            assert.strictEqual(result, true);
            assert.strictEqual(mockXmppConnection.sentIqs.length, 1);
            
            const sentIq = mockXmppConnection.sentIqs[0];
            assert.strictEqual(sentIq.getChild('jingle').attrs.action, JingleAction.SESSION_INITIATE);
            assert.strictEqual(sentIq.getChild('jingle').attrs.sid, 'test-sid-123');
        });

        it('should handle session termination', async () => {
            await session.terminate({ name: 'success' }, 'Test termination', true);
            assert.strictEqual(session.state, State.ENDED);
            assert.strictEqual(mockXmppConnection.sentIqs.length, 1);
            
            const sentIq = mockXmppConnection.sentIqs[0];
            assert.strictEqual(sentIq.getChild('jingle').attrs.action, JingleAction.SESSION_TERMINATE);
        });

        it('should process incoming Jingle IQs', async () => {
            const iq = createElement('iq', { type: 'set', from: 'participant@example.com/resource', id: 'test-id' },
                createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SESSION_ACCEPT, sid: 'test-sid-123' })
            );

            await session.processJingleIq(iq, JingleAction.SESSION_ACCEPT, []);
            assert.strictEqual(session.state, State.ACTIVE);
            assert.strictEqual(session.isActive(), true);
        });

        it('should handle source-add and source-remove', async () => {
            // First make session active
            session.state = State.ACTIVE;
            
            const sourcesMap = new ConferenceSourceMap();
            // Add a dummy Source instance so the IQ is actually sent
            const dummySource = new Source(12345, MediaType.AUDIO);
            const dummyEndpointSet = new EndpointSourceSet(new Set([dummySource]));
            sourcesMap.add('participant1', dummyEndpointSet);

            await session.addSource(sourcesMap);
            assert.strictEqual(mockXmppConnection.sentIqs.length, 1);
            assert.strictEqual(mockXmppConnection.sentIqs[0].getChild('jingle').attrs.action, JingleAction.SOURCEADD);

            mockXmppConnection.clearSentIqs();
            await session.removeSource(sourcesMap);
            assert.strictEqual(mockXmppConnection.sentIqs.length, 1);
            assert.strictEqual(mockXmppConnection.sentIqs[0].getChild('jingle').attrs.action, JingleAction.SOURCEREMOVE);
        });
    });

    describe('JingleIqRequestHandler', () => {
        it('should register and manage sessions', () => {
            const session = new JingleSession(
                'test-sid-123',
                'participant@example.com/resource',
                mockJingleHandler,
                mockXmppConnection,
                new NoOpJingleRequestHandler(),
                false
            );

            jingleIqRequestHandler.registerSession(session);
            assert.strictEqual(jingleIqRequestHandler.getSession('test-sid-123'), session);
            assert.strictEqual(jingleIqRequestHandler.getAllSessions().length, 1);

            jingleIqRequestHandler.removeSession(session);
            assert.strictEqual(jingleIqRequestHandler.getSession('test-sid-123'), null);
            assert.strictEqual(jingleIqRequestHandler.getAllSessions().length, 0);
        });

        it('should handle requests for registered sessions', async () => {
            const session = new JingleSession(
                'test-sid-123',
                'participant@example.com/resource',
                mockJingleHandler,
                mockXmppConnection,
                new NoOpJingleRequestHandler(),
                false
            );

            jingleIqRequestHandler.registerSession(session);

            const iq = createElement('iq', { type: 'set', from: 'participant@example.com/resource', id: 'test-id' },
                createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SESSION_ACCEPT, sid: 'test-sid-123' })
            );

            const response = await jingleIqRequestHandler.handleRequest({ iq });
            assert.ok(response);
            assert.strictEqual(response.attrs.type, 'result');
        });

        it('should return error for unknown sessions', async () => {
            const iq = createElement('iq', { type: 'set', from: 'participant@example.com/resource', id: 'test-id' },
                createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SESSION_ACCEPT, sid: 'unknown-sid' })
            );

            const response = await jingleIqRequestHandler.handleRequest({ iq });
            assert.ok(response);
            assert.strictEqual(response.attrs.type, 'error');
        });
    });

    describe('JingleRequestHandler', () => {
        it('should provide default implementations', async () => {
            const handler = new JingleRequestHandler();
            const session = new JingleSession(
                'test-sid-123',
                'participant@example.com/resource',
                mockJingleHandler,
                mockXmppConnection,
                handler,
                false
            );

            // All methods should return null (no error) by default
            const result1 = await handler.onAddSource(session, []);
            const result2 = await handler.onRemoveSource(session, []);
            const result3 = await handler.onSessionAccept(session, []);
            const result4 = await handler.onSessionInfo(session, {});
            const result5 = await handler.onSessionTerminate(session, {});
            const result6 = await handler.onTransportInfo(session, []);
            const result7 = await handler.onTransportAccept(session, []);

            assert.strictEqual(result1, null);
            assert.strictEqual(result2, null);
            assert.strictEqual(result3, null);
            assert.strictEqual(result4, null);
            assert.strictEqual(result5, null);
            assert.strictEqual(result6, null);
            assert.strictEqual(result7, null);
        });
    });

    describe('JingleStats', () => {
        it('should track stanza statistics', () => {
            jingleStatsInstance.stanzaReceived('session-initiate');
            jingleStatsInstance.stanzaReceived('session-accept');
            jingleStatsInstance.stanzaSent('session-initiate');

            const stats = jingleStatsInstance.getStats();
            assert.strictEqual(stats.stanzas.received['session-initiate'], 1);
            assert.strictEqual(stats.stanzas.received['session-accept'], 1);
            assert.strictEqual(stats.stanzas.sent['session-initiate'], 1);
        });

        it('should track session events', () => {
            jingleStatsInstance.sessionEvent('created');
            jingleStatsInstance.sessionEvent('active');
            jingleStatsInstance.sessionEvent('ended');

            const stats = jingleStatsInstance.getStats();
            assert.strictEqual(stats.sessions.total, 1);
            assert.strictEqual(stats.sessions.successful, 1);
            assert.strictEqual(stats.sessions.active, 0); // ended decrements active
        });

        it('should track transport events', () => {
            jingleStatsInstance.transportReplace(true);
            jingleStatsInstance.transportReplace(false);

            const stats = jingleStatsInstance.getStats();
            assert.strictEqual(stats.transport.replaces, 2);
            assert.strictEqual(stats.transport.successes, 1);
            assert.strictEqual(stats.transport.failures, 1);
        });

        it('should track source events', () => {
            jingleStatsInstance.sourceEvent('add', true);
            jingleStatsInstance.sourceEvent('remove', false);

            const stats = jingleStatsInstance.getStats();
            assert.strictEqual(stats.sources.adds, 1);
            assert.strictEqual(stats.sources.removes, 1);
            assert.strictEqual(stats.sources.failures, 1);
        });

        it('should reset statistics', () => {
            jingleStatsInstance.stanzaReceived('session-initiate');
            jingleStatsInstance.sessionEvent('created');
            
            jingleStatsInstance.reset();
            
            const stats = jingleStatsInstance.getStats();
            assert.strictEqual(Object.keys(stats.stanzas.received).length, 0);
            assert.strictEqual(stats.sessions.total, 0);
        });
    });

    describe('Integration Tests', () => {
        it('should handle complete Jingle session lifecycle', async () => {
            const requestHandler = new NoOpJingleRequestHandler();
            const session = new JingleSession(
                'integration-test-sid',
                'participant@example.com/resource',
                mockJingleHandler,
                mockXmppConnection,
                requestHandler,
                false
            );

            // Register session
            jingleIqRequestHandler.registerSession(session);

            // Initiate session
            const initiateResult = await session.initiateSession();
            assert.strictEqual(initiateResult, true);

            // Simulate session-accept
            const acceptIq = createElement('iq', { type: 'set', from: 'participant@example.com/resource', id: 'accept-id' },
                createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SESSION_ACCEPT, sid: 'integration-test-sid' })
            );

            await session.processJingleIq(acceptIq, JingleAction.SESSION_ACCEPT, []);
            assert.strictEqual(session.state, State.ACTIVE);

            // Test source signaling
            const sourcesMap = new ConferenceSourceMap();
            sourcesMap.add('participant1', new EndpointSourceSet());

            await session.addSource(sourcesMap);
            await session.removeSource(sourcesMap);

            // Terminate session
            await session.terminate({ name: 'success' }, 'Integration test complete', true);
            assert.strictEqual(session.state, State.ENDED);

            // Verify statistics
            const stats = jingleStatsInstance.getStats();
            assert.ok(stats.stanzas.sent['session-initiate'] > 0);
            assert.ok(stats.stanzas.sent['session-terminate'] > 0);
        });
    });
}); 

describe('JingleOfferFactory', () => {
    it('should create an audio+video offer with correct codecs and extensions', () => {
        const offer = createJingleOffer({ audio: true, video: true, sctp: false, config: defaultJingleConfig });
        const audioContent = offer.find(c => c.attrs.name === 'audio');
        const videoContent = offer.find(c => c.attrs.name === 'video');
        assert.ok(audioContent);
        assert.ok(videoContent);
        // Check payload-types
        const audioPayloads = audioContent.getChild('description').getChildren('payload-type');
        assert.ok(audioPayloads.length > 0);
        const opus = audioPayloads.find(pt => pt.attrs.name === 'opus');
        assert.ok(opus);
        // Check parameters and feedback
        const opusParams = opus.getChildren('parameter');
        assert.ok(opusParams.some(p => p.attrs.name === 'minptime'));
        const opusFb = opus.getChildren('rtcp-fb');
        assert.ok(opusFb.some(fb => fb.attrs.type === 'transport-cc'));
        // Video
        const videoPayloads = videoContent.getChild('description').getChildren('payload-type');
        assert.ok(videoPayloads.length > 0);
        const vp8 = videoPayloads.find(pt => pt.attrs.name === 'VP8');
        assert.ok(vp8);
        const vp8Fb = vp8.getChildren('rtcp-fb');
        assert.ok(vp8Fb.some(fb => fb.attrs.type === 'ccm' && fb.attrs.subtype === 'fir'));
        assert.ok(vp8Fb.some(fb => fb.attrs.type === 'nack'));
    });

    it('should create an audio-only offer', () => {
        const offer = createJingleOffer({ audio: true, video: false, sctp: false, config: defaultJingleConfig });
        assert.strictEqual(offer.length, 1);
        assert.strictEqual(offer[0].attrs.name, 'audio');
    });

    it('should create a video-only offer', () => {
        const offer = createJingleOffer({ audio: false, video: true, sctp: false, config: defaultJingleConfig });
        assert.strictEqual(offer.length, 1);
        assert.strictEqual(offer[0].attrs.name, 'video');
    });

    it('should include data content if sctp is true', () => {
        const offer = createJingleOffer({ audio: false, video: false, sctp: true, config: defaultJingleConfig });
        assert.strictEqual(offer.length, 1);
        assert.strictEqual(offer[0].attrs.name, 'data');
    });
}); 