const logger = require('../utils/logger');
const { client, xml } = require('@xmpp/client'); // Using @xmpp/client
const EventEmitter = require('events');
const conferenceStore = require('../common/conferenceStore');

// Wrapper for @xmpp/client to somewhat mimic the XmppConnection interface used elsewhere
// and to manage Jicofo-specific needs like listeners for registration changes.
class ManagedXmppConnection extends EventEmitter {
    constructor(name, connectionConfig, { conferenceStore, authenticationAuthority, jigasiDetector } = {}) {
        super();
        this.name = name;
        this.config = connectionConfig; // { service, domain, username, password, resource }
        this.xmpp = null; // This will hold the @xmpp/client instance
        this.listeners = []; // For Jicofo-specific listeners (e.g., FocusManager for registration)
        this.isRegistered = false; // Track XMPP registration status
        this.conferenceStore = conferenceStore;
        this.authenticationAuthority = authenticationAuthority;
        this.jigasiDetector = jigasiDetector;

        logger.info(`ManagedXmppConnection "${name}" created with config (password hidden).`);
    }

    async connect() {
        if (this.xmpp && this.xmpp.status !== 'offline') {
            logger.warn(`XMPP Connection "${this.name}" already connected or connecting.`);
            return;
        }

        logger.info(`XMPP Connection "${this.name}" connecting to ${this.config.service}...`);

        this.xmpp = client({
            service: this.config.service, // e.g., 'ws://localhost:5280/xmpp-websocket' or 'xmpp://localhost:5222'
            domain: this.config.domain,
            resource: this.config.resource || `jicofo-node-${this.name}`,
            username: this.config.username,
            password: this.config.password,
        });

        this._initializeIqProcessing(); // Call it here

        this.xmpp.on('error', (err) => {
            logger.error(`XMPP Error (${this.name}):`, err.message || err.toString());
            // Additional error details if available (e.g., err.stanza)
            if (err.stanza) {
                logger.error(`XMPP Error Stanza (${this.name}): ${err.stanza.toString()}`);
            }
            this._updateRegistrationStatus(false);
        });

        this.xmpp.on('offline', () => {
            logger.info(`XMPP Connection "${this.name}" is offline.`);
            this._updateRegistrationStatus(false);
            // Optional: Implement retry logic here or rely on higher-level components
        });

        this.xmpp.on('online', async (address) => {
            logger.info(`XMPP Connection "${this.name}" is online as ${address.toString()}`);
            // Send initial presence or other setup if needed
            await this.xmpp.send(xml('presence'));
            this._updateRegistrationStatus(true);
            // Setup AV moderation XMPP message handler
            setupAvModerationHandler(this, this.conferenceStore);
            setupConferenceIqHandler(this, this.conferenceStore);
            // Setup additional IQ handlers
            setupAuthenticationIqHandler(this, this.authenticationAuthority);
            setupMuteIqHandlers(this, this.conferenceStore);
            setupJibriIqHandler(this, this.conferenceStore);
            setupJigasiIqHandler(this, this.conferenceStore, this.jigasiDetector);
            // Setup participant join/leave logic via presence
            this.addPresenceListener((stanza) => {
                // Only handle MUC presence
                const to = stanza.attrs.to || '';
                const from = stanza.attrs.from || '';
                // MUC JID format: room@conference.example.com/nick
                const mucMatch = to.match(/^([^/]+)\/([^/]+)$/);
                if (!mucMatch) return;
                const room = mucMatch[1];
                const nick = mucMatch[2];
                // Determine join/leave
                if (stanza.attrs.type === 'unavailable') {
                    this.conferenceStore.removeParticipant(room, nick);
                    logger.info(`Participant left: ${nick} from ${room}`);
                } else {
                    // For demo, treat all as non-moderator
                    this.conferenceStore.addParticipant(room, { id: nick, isModerator: false, isMuted: {} });
                    logger.info(`Participant joined: ${nick} to ${room}`);
                }
            });
        });

        // Debugging raw stanzas (optional)
        // this.xmpp.on('stanza', (stanza) => {
        //     logger.debug(`XMPP RECV (${this.name}): ${stanza.toString()}`);
        // });
        // this.xmpp.on('send', (stanza) => {
        //    logger.debug(`XMPP SEND (${this.name}): ${stanza.toString()}`);
        // });

        try {
            await this.xmpp.start();
        } catch (err) {
            logger.error(`XMPP Connection "${this.name}" failed to start:`, err);
            this._updateRegistrationStatus(false);
            // Rethrow or handle as appropriate, so callers know connection failed.
            throw err;
        }
    }

    async disconnect() {
        if (this.xmpp) {
            logger.info(`XMPP Connection "${this.name}" disconnecting...`);
            try {
                // await this.xmpp.send(xml('presence', { type: 'unavailable' })); // Politely say goodbye
                await this.xmpp.stop();
                logger.info(`XMPP Connection "${this.name}" disconnected.`);
            } catch (e) {
                logger.error(`Error during XMPP disconnect (${this.name}):`, e);
            } finally {
                this._updateRegistrationStatus(false);
                this.xmpp = null; // Clear the client instance
            }
        }
    }

    _updateRegistrationStatus(isRegistered) {
        if (this.isRegistered !== isRegistered) {
            this.isRegistered = isRegistered;
            logger.info(`XMPP Connection "${this.name}" registration status changed to: ${isRegistered}`);
            this.listeners.forEach(listener => {
                if (typeof listener.registrationChanged === 'function') {
                    try {
                        listener.registrationChanged(isRegistered);
                    } catch (e) {
                        logger.error(`Error in registrationChanged listener for ${this.name}:`, e);
                    }
                }
            });
            this.emit('registrationChanged', isRegistered); // Emit event for other potential listeners
        }
    }

    addListener(listener) { // For Jicofo-specific XmppProvider.Listener
        if (!this.listeners.includes(listener)) {
            this.listeners.push(listener);
            logger.info(`Listener added to XMPP Connection "${this.name}". Current count: ${this.listeners.length}`);
        }
    }

    removeListener(listener) { // For Jicofo-specific XmppProvider.Listener
        this.listeners = this.listeners.filter(l => l !== listener);
        logger.info(`Listener removed from XMPP Connection "${this.name}". Current count: ${this.listeners.length}`);
    }

    // Method to send stanzas (example)
    async send(element) {
        if (this.xmpp && this.xmpp.status === 'online') {
            return this.xmpp.send(element);
        } else {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot send element.`);
            throw new Error(`XMPP client ${this.name} not online`);
        }
    }

    // Method to send IQ stanzas and get a reply (example)
    async sendIq(element) {
        if (this.xmpp && this.xmpp.status === 'online') {
            return this.xmpp.iqCaller.request(element);
        } else {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot send IQ.`);
            throw new Error(`XMPP client ${this.name} not online`);
        }
    }

    // Add other necessary XMPP methods (e.g., addPresenceListener, addStanzaListener) by exposing parts of this.xmpp or wrapping them.

    /**
     * Joins a Multi-User Chat room.
     * @param {string} roomJid - The JID of the MUC room (e.g., "room@conference.example.com").
     * @param {string} nick - The nickname to use in the MUC.
     */
    async joinMuc(roomJid, nick) {
        if (!this.xmpp || this.xmpp.status !== 'online') {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot join MUC ${roomJid}.`);
            throw new Error(`XMPP client ${this.name} not online, cannot join MUC`);
        }
        const mucAddress = `${roomJid}/${nick}`;
        logger.info(`XMPP Connection "${this.name}" joining MUC ${mucAddress}`);
        try {
            // Send presence to join/create the room
            // XEP-0045 specifies sending presence to room@service/nick
            // <presence to='darkcave@chat.example.com/thirdwitch'><x xmlns='http://jabber.org/protocol/muc'/></presence>
            await this.send(
                xml('presence', { to: mucAddress },
                    xml('x', { xmlns: 'http://jabber.org/protocol/muc' })
                )
            );
            logger.info(`XMPP Connection "${this.name}" successfully sent presence to join MUC ${mucAddress}.`);
            // TODO: Listen for self-presence to confirm join and for presence from other occupants.
            // TODO: Listen for messages from this MUC.
        } catch (e) {
            logger.error(`Error joining MUC ${mucAddress} on connection "${this.name}":`, e);
            throw e;
        }
    }

    /**
     * Sends a message to a Multi-User Chat room.
     * @param {string} roomJid - The JID of the MUC room (e.g., "room@conference.example.com").
     * @param {string} messageBody - The body of the message.
     * @param {string} [messageType='groupchat'] - The type of the message (usually 'groupchat').
     */
    async sendMucMessage(roomJid, messageBody, messageType = 'groupchat') {
        if (!this.xmpp || this.xmpp.status !== 'online') {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot send MUC message to ${roomJid}.`);
            throw new Error(`XMPP client ${this.name} not online, cannot send MUC message`);
        }
        logger.debug(`XMPP Connection "${this.name}" sending MUC message to ${roomJid}: ${messageBody}`);
        try {
            await this.send(
                xml('message', { to: roomJid, type: messageType },
                    xml('body', {}, messageBody)
                )
            );
        } catch (e) {
            logger.error(`Error sending MUC message to ${roomJid} on connection "${this.name}":`, e);
            throw e;
        }
    }

    /**
     * Leaves a Multi-User Chat room.
     * @param {string} roomJid - The JID of the MUC room (e.g., "room@conference.example.com").
     * @param {string} nick - The nickname used in the MUC.
     * @param {string} [statusMessage] - Optional status message for leaving.
     */
    async leaveMuc(roomJid, nick, statusMessage) {
        if (!this.xmpp || this.xmpp.status !== 'online') {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot leave MUC ${roomJid}.`);
            // Don't throw, as we might be offline already.
            return;
        }
        const mucAddress = `${roomJid}/${nick}`;
        logger.info(`XMPP Connection "${this.name}" leaving MUC ${mucAddress}`);
        try {
            const presenceAttrs = { to: mucAddress, type: 'unavailable' };
            const statusEl = statusMessage ? xml('status', {}, statusMessage) : null;
            await this.send(
                xml('presence', presenceAttrs, statusEl)
            );
            logger.info(`XMPP Connection "${this.name}" successfully sent presence to leave MUC ${mucAddress}.`);
            // TODO: Remove MUC-specific listeners if they were added.
        } catch (e) {
            logger.error(`Error leaving MUC ${mucAddress} on connection "${this.name}":`, e);
            // Don't rethrow, as the intention is to leave.
        }
    }

    /**
     * Sends a directed presence stanza.
     * @param {string} [toJid] - Optional JID to send presence to. If null, sends broadcast presence.
     * @param {string} [show] - Optional presence show element value (e.g., 'chat', 'away', 'dnd', 'xa').
     * @param {string} [status] - Optional presence status message.
     * @param {string} [type='available'] - Presence type, usually 'available' or 'unavailable'.
     */
    async sendPresence(toJid, show, status, type = 'available') {
        if (!this.xmpp || this.xmpp.status !== 'online') {
            logger.warn(`XMPP Connection "${this.name}" is not online. Cannot send presence.`);
            throw new Error(`XMPP client ${this.name} not online, cannot send presence`);
        }

        const presenceAttrs = {};
        if (toJid) presenceAttrs.to = toJid;
        if (type !== 'available') presenceAttrs.type = type; // 'available' is default, not usually included unless it's e.g. unavailable

        const children = [];
        if (show) children.push(xml('show', {}, show));
        if (status) children.push(xml('status', {}, status));

        // If type is 'unavailable', 'to' is usually not present for broadcast unavailable
        if (type === 'unavailable' && !toJid) {
             delete presenceAttrs.to; // Ensure it's a broadcast unavailable
        } else if (type === 'available' && !toJid && children.length === 0) {
            // Standard broadcast presence (no children, no 'to')
             await this.send(xml('presence'));
             return;
        }


        logger.debug(`XMPP Connection "${this.name}" sending presence: to=${toJid}, type=${type}, show=${show}, status=${status}`);
        await this.send(xml('presence', presenceAttrs, ...children));
    }

    /**
     * Adds a global listener for presence stanzas.
     * Use this carefully to avoid too many generic listeners.
     * @param {function(object): void} callback - Function to call with the received presence stanza object.
     */
    addPresenceListener(callback) {
        if (!this.xmpp) {
            logger.warn(`XMPP Connection "${this.name}" not initialized. Cannot add presence listener.`);
            return;
        }
        // This is a simplified listener. A more robust solution might involve an event emitter
        // pattern within ManagedXmppConnection for different stanza types.
        // For now, we hook into the raw 'stanza' event.
        const handler = (stanza) => {
            if (stanza.is('presence')) {
                callback(stanza);
            }
        };
        this.xmpp.on('stanza', handler);
        logger.info(`XMPP Connection "${this.name}": Added a global presence listener.`);
        // Return a function to remove the listener
        return () => {
            this.xmpp.off('stanza', handler);
            logger.info(`XMPP Connection "${this.name}": Removed a global presence listener.`);
        };
    }

    // --- IQ Handling ---
    // Store for IQ handlers: Map<string (namespace), Map<string (elementName), function(iq)>>
    // Or a more sophisticated router if many handlers are expected.
    // For now, let's make it simple: Map<string (elementName#namespace), function(iq)>
    _iqHandlers = new Map();

    /**
     * Registers a handler for specific IQ stanzas.
     * @param {string} elementName - The name of the direct child element of the IQ that identifies the payload.
     * @param {string} namespace - The XML namespace of that child element.
     * @param {function(object): Promise<object|null>} handlerFn - An async function that takes the full IQ stanza
     *        and should return an IQ stanza (result or error) or null if handled without explicit reply.
     *        The handler is responsible for constructing the complete response IQ.
     */
    registerIqHandler(elementName, namespace, handlerFn) {
        const key = `${elementName}|${namespace}`;
        if (this._iqHandlers.has(key)) {
            logger.warn(`XMPP Connection "${this.name}": Overwriting IQ handler for ${key}`);
        }
        this._iqHandlers.set(key, handlerFn);
        logger.info(`XMPP Connection "${this.name}": Registered IQ handler for ${elementName} in namespace ${namespace}`);
    }

    unregisterIqHandler(elementName, namespace) {
        const key = `${elementName}|${namespace}`;
        if (this._iqHandlers.delete(key)) {
            logger.info(`XMPP Connection "${this.name}": Unregistered IQ handler for ${elementName} in namespace ${namespace}`);
        }
    }

    _initializeIqProcessing() {
        if (!this.xmpp) return;

        this.xmpp.on('stanza', async (stanza) => {
            if (!stanza.is('iq')) return;

            const iqType = stanza.attrs.type;
            // We are interested in 'get' or 'set' IQs that are requests, not results or errors to our own requests.
            // xmpp.iqCaller handles responses to our outgoing IQs.
            if (iqType === 'get' || iqType === 'set') {
                const queryElement = stanza.getChildByAttr('xmlns'); // A common way to get the main payload

                if (queryElement) {
                    const elementName = queryElement.name;
                    const namespace = queryElement.attrs.xmlns;
                    const key = `${elementName}|${namespace}`;

                    const handler = this._iqHandlers.get(key);
                    if (handler) {
                        logger.debug(`XMPP Connection "${this.name}": Handling IQ for ${key} from ${stanza.attrs.from}`);
                        try {
                            const responseStanza = await handler(stanza);
                            if (responseStanza) {
                                await this.send(responseStanza);
                            }
                        } catch (e) {
                            logger.error(`XMPP Connection "${this.name}": Error in IQ handler for ${key}:`, e);
                            // Send an error IQ in response
                            if (stanza.attrs.id) {
                                const errorResponse = xml('iq', {
                                        type: 'error',
                                        to: stanza.attrs.from,
                                        id: stanza.attrs.id
                                    },
                                    xml(stanza.children[0].name, stanza.children[0].attrs), // Echo the query
                                    xml('error', { type: 'cancel' },
                                        xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                                    )
                                );
                                await this.send(errorResponse);
                            }
                        }
                    } else {
                        logger.warn(`XMPP Connection "${this.name}": No IQ handler for ${key} from ${stanza.attrs.from}. Type: ${iqType}. Stanza: ${stanza.toString()}`);
                        // Send feature-not-implemented or service-unavailable if it's a request we should respond to
                        if (stanza.attrs.id && (iqType === 'get' || iqType === 'set')) {
                             const errorResponse = xml('iq', {
                                    type: 'error',
                                    to: stanza.attrs.from,
                                    id: stanza.attrs.id
                                },
                                xml(stanza.children[0].name, stanza.children[0].attrs), // Echo the query
                                xml('error', { type: 'cancel' },
                                    xml('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                                )
                            );
                            await this.send(errorResponse);
                        }
                    }
                } else {
                     logger.warn(`XMPP Connection "${this.name}": Received IQ type ${iqType} without a namespaced child element from ${stanza.attrs.from}. Stanza: ${stanza.toString()}`);
                }
            }
        });
        logger.info(`XMPP Connection "${this.name}": Initialized IQ processing.`);
    }
}

class XmppServices {
    constructor({ conferenceStore, focusManager, authenticationAuthority, jigasiDetector }) {
        logger.info('XmppServices initializing...');
        this.conferenceStore = conferenceStore;
        this.focusManager = focusManager;
        this.authenticationAuthority = authenticationAuthority;
        this.jigasiDetector = jigasiDetector;

        // Retrieve XMPP connection configurations from the main config
        // Assumes config structure like:
        // xmpp: {
        //   client: { service: "ws://localhost:5280/xmpp-websocket", domain: "example.com", username: "jicofo-c", password: "password" },
        //   service: { service: "xmpp://localhost:5222", domain: "example.com", username: "jicofo-s", password: "password" }
        // }
        const xmppConfig = require('../config').getConfig('xmpp') || {};

        this.clientConnectionConfig = xmppConfig.client;
        this.serviceConnectionConfig = xmppConfig.service;

        if (!this.clientConnectionConfig || !this.clientConnectionConfig.service) {
            logger.error("XMPP client connection configuration (xmpp.client) is missing or incomplete in config!");
            // Potentially throw an error or operate in a degraded mode
            this.clientConnection = new ManagedXmppConnection('client_unconfigured', {}, {
                conferenceStore: this.conferenceStore,
                authenticationAuthority: this.authenticationAuthority,
                jigasiDetector: this.jigasiDetector
            }); // Dummy
        } else {
            this.clientConnection = new ManagedXmppConnection('client', this.clientConnectionConfig, {
                conferenceStore: this.conferenceStore,
                authenticationAuthority: this.authenticationAuthority,
                jigasiDetector: this.jigasiDetector
            });
        }

        if (!this.serviceConnectionConfig || !this.serviceConnectionConfig.service) {
            logger.warn("XMPP service connection configuration (xmpp.service) is missing or incomplete. May not be used by all features.");
            // This one might be optional depending on features used (e.g. JvbDoctor)
            this.serviceConnection = new ManagedXmppConnection('service_unconfigured', {}, {
                conferenceStore: this.conferenceStore,
                authenticationAuthority: this.authenticationAuthority,
                jigasiDetector: this.jigasiDetector
            }); // Dummy
        } else {
            this.serviceConnection = new ManagedXmppConnection('service', this.serviceConnectionConfig, {
                conferenceStore: this.conferenceStore,
                authenticationAuthority: this.authenticationAuthority,
                jigasiDetector: this.jigasiDetector
            });
        }

        // TODO: Connect the XMPP clients. This could be done here, or in JicofoServices.start()
        // For now, let's assume JicofoServices will call a method to connect them.
        // await this.clientConnection.connect();
        // if (this.serviceConnectionConfig) await this.serviceConnection.connect();


        // Placeholder for ConferenceIqHandler, AvModerationHandler, JigasiDetector
        this.conferenceIqHandler = { debugState: {}, handleConferenceIq: async (iq) => { /* ... */ } };
        this.avModerationHandler = { debugState: {} };
        this.jigasiDetector = null;
        this.jigasiStats = {};

        logger.info('XmppServices initialized.');
    }

    async startConnections() {
        logger.info('XmppServices: Starting XMPP connections...');
        try {
            if (this.clientConnectionConfig?.service) { // Only connect if configured
                await this.clientConnection.connect();
            } else {
                 logger.warn('XMPP client connection not started due to missing configuration.');
            }
            if (this.serviceConnectionConfig?.service) { // Only connect if configured
                await this.serviceConnection.connect();
            } else {
                 logger.warn('XMPP service connection not started due to missing configuration.');
            }
            logger.info('XMPP connections initiated.');
        } catch (error) {
            logger.error('XmppServices: Error starting XMPP connections:', error);
            // Decide if this is fatal for Jicofo startup
            throw error;
        }
    }


    getXmppConnectionByName(name) {
        logger.debug(`XmppServices getXmppConnectionByName: ${name}`);
        if (name === this.serviceConnection.name && this.serviceConnectionConfig?.service) {
            return this.serviceConnection;
        }
        if (name === this.clientConnection.name && this.clientConnectionConfig?.service) {
            return this.clientConnection;
        }
        logger.warn(`Requested XMPP connection "${name}" not found or not configured, defaulting to client connection if available.`);
        return this.clientConnectionConfig?.service ? this.clientConnection : null; // Return null if client is also not configured
    }

    async shutdown() {
        logger.info('XmppServices shutting down XMPP connections...');
        try {
            await this.clientConnection.disconnect();
        } catch (e) {
            logger.error("Error disconnecting client XMPP connection:", e);
        }
        try {
            await this.serviceConnection.disconnect();
        } catch (e) {
            logger.error("Error disconnecting service XMPP connection:", e);
        }
        logger.info('XMPP connections shut down.');
    }

    // TODO: Add other methods from XmppServices.kt
    // - addHandler, removeHandler for various IQs, messages, presence
    // - Methods to send specific types of IQs (e.g., Colibri, Jingle)

    // --- Jingle Handling --- (To be used by JingleHandler in XmppServices)
    /**
     * Provides the raw iqCaller from @xmpp/client for sending IQs and handling responses.
     * JingleSession will need this or a wrapper.
     */
    get iqCaller() {
        if (!this.xmpp) {
            throw new Error(`XMPP connection ${this.name} not initialized, no iqCaller.`);
        }
        return this.xmpp.iqCaller;
    }
}


class JingleHandler {
    constructor(xmppConnection, parentLogger) {
        this.xmppConnection = xmppConnection; // This is a ManagedXmppConnection instance
        this.logger = parentLogger.child({ component: 'JingleHandler' });
        this.activeSessions = new Map(); // SID -> JingleSession instance

        // Register a handler for all Jingle IQs on the XMPP connection
        this.xmppConnection.registerIqHandler('jingle', 'urn:xmpp:jingle:1', this.handleJingleIq.bind(this));
        this.logger.info('Jingle IQ handler registered.');
    }

    /**
     * Handles incoming Jingle IQs.
     * @param {object} iq - The incoming Jingle IQ stanza (from @xmpp/xml).
     * @returns {Promise<object|null>} A response IQ stanza or null.
     */
    async handleJingleIq(iq) {
        const jingleElement = iq.getChild('jingle', 'urn:xmpp:jingle:1');
        if (!jingleElement) {
            this.logger.warn('Received IQ in Jingle namespace without <jingle> element.');
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }

        const sid = jingleElement.attrs.sid;
        const action = jingleElement.attrs.action;
        const fromJid = iq.attrs.from;

        this.logger.debug(`Received Jingle IQ: action=${action}, sid=${sid}, from=${fromJid}`);

        const session = this.activeSessions.get(sid);

        if (session) {
            // Delegate to the JingleSession's internal handler
            // The JingleSession's handler (which is Participant.jingleRequestHandler)
            // will construct the appropriate response or error.
            return session.processJingleIq(iq, action, jingleElement.getChildren());
        } else {
            // If it's not session-initiate and no session exists, it's an error
            if (action !== 'session-initiate') {
                this.logger.warn(`No active Jingle session found for SID: ${sid} (action: ${action}).`);
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    jingleElement, // Echo the jingle element
                    xml('error', { type: 'cancel' },
                        xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            } else {
                // This is a session-initiate for a new session.
                // Jicofo typically initiates sessions, but if it were to receive them:
                // It would find/create a Participant based on 'fromJid' (or 'to' if Jicofo is component),
                // then call participant.handleIncomingSessionInitiate(iq).
                this.logger.info(`Received session-initiate for new SID: ${sid} from ${fromJid}. Jicofo primarily initiates.`);
                // For now, as Jicofo is the initiator, we might just send an unexpected-request.
                // Or, if this 'fromJid' corresponds to an expected participant for whom we haven't initiated yet,
                // this could be a race. The Participant object should handle this.
                // This part needs to be coordinated with how JitsiMeetConference manages participants and initiates calls.
                // For now, assume the JitsiMeetConference/Participant is responsible for initiating.
                // If Jicofo *can* receive session-initiate, a lookup for the target participant is needed here.

                // Placeholder: In a typical responder scenario, you'd find the target (e.g. a conference)
                // and delegate. If Jicofo doesn't expect to be a responder for session-initiate directly this way:
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    jingleElement,
                    xml('error', { type: 'cancel' },
                        xml('unexpected-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            }
        }
    }

    registerSession(session) { // session is an instance of our JingleSession class
        if (!session || !session.sid) {
            this.logger.error('Attempted to register an invalid session.');
            return;
        }
        this.logger.info(`Registering Jingle session: ${session.sid}`);
        this.activeSessions.set(session.sid, session);
    }

    unregisterSession(sid) {
        if (this.activeSessions.delete(sid)) {
            this.logger.info(`Unregistered Jingle session: ${sid}`);
        }
    }

    // This method is what Participant's JingleSession would use to send IQs.
    // It needs access to the XMPP connection's sendIq or iqCaller.
    async sendIq(iqElement) {
        return this.xmppConnection.sendIq(iqElement);
    }
     /**
     * Provides the raw iqCaller from @xmpp/client for sending IQs and handling responses,
     * or a wrapper around sendIq for more structured requests if preferred.
     * JingleSession will need this.
     */
    get iqCaller() {
        return this.xmppConnection.iqCaller;
    }
}




// `initializeSmack()` is not directly applicable to `@xmpp/client` as setup is per-instance.
function initializeSmack() {
    logger.info('initializeSmack: (No-op for @xmpp/client, setup is per-connection instance)');
}

// AV Moderation XMPP message handler
function setupAvModerationHandler(xmppConnection, conferenceStore) {
    if (!xmppConnection || !xmppConnection.xmpp) return;
    xmppConnection.xmpp.on('stanza', async (stanza) => {
        if (!stanza.is('message')) return;
        const type = stanza.attrs.type;
        if (type !== 'groupchat' && type !== 'normal') return;
        // Look for a <json-message> extension (Jitsi style)
        const jsonMessageEl = stanza.getChild('json-message', 'http://jitsi.org/jitmeet');
        if (!jsonMessageEl) return;
        let json;
        try {
            json = JSON.parse(jsonMessageEl.text());
        } catch (e) {
            logger.warn('Failed to parse json-message:', e);
            return;
        }
        if (json.type !== 'av_moderation') return;
        const room = json.room;
        if (!room) {
            logger.warn('av_moderation message missing room');
            return;
        }
        // Enable/disable moderation
        if (typeof json.enabled === 'boolean' && json.mediaType) {
            conferenceStore.setAvModerationEnabled(room, json.mediaType, json.enabled);
            logger.info(`AV moderation for ${json.mediaType} in ${room} set to ${json.enabled}`);
        }
        // Set whitelist
        if (json.whitelists && typeof json.whitelists === 'object') {
            for (const [mediaType, whitelist] of Object.entries(json.whitelists)) {
                conferenceStore.setAvModerationWhitelist(room, mediaType, whitelist);
                logger.info(`AV moderation whitelist for ${mediaType} in ${room} set to: ${JSON.stringify(whitelist)}`);
            }
        }
    });
}

// Register Conference IQ handler (focus)
function setupConferenceIqHandler(xmppConnection, conferenceStore) {
    // Only register if xmppConnection supports IQ handlers
    if (!xmppConnection.registerIqHandler) return;
    xmppConnection.registerIqHandler('conference', 'http://jitsi.org/protocol/focus', async (iq) => {
        // Parse room from IQ
        const query = iq.getChild('conference', 'http://jitsi.org/protocol/focus');
        const room = query && query.attrs && query.attrs.room;
        if (!room) {
            // Return error IQ (bad-request)
            return xmppConnection.xmpp.stanza('iq', {
                type: 'error',
                to: iq.attrs.from,
                id: iq.attrs.id
            },
                xmppConnection.xmpp.stanza('conference', { xmlns: 'http://jitsi.org/protocol/focus' }),
                xmppConnection.xmpp.stanza('error', { type: 'modify' },
                    xmppConnection.xmpp.stanza('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        // Create or get the conference
        conferenceStore.createConference(room, {});
        // Respond with a result IQ (minimal for now)
        return xmppConnection.xmpp.stanza('iq', {
            type: 'result',
            to: iq.attrs.from,
            id: iq.attrs.id
        },
            xmppConnection.xmpp.stanza('conference', { xmlns: 'http://jitsi.org/protocol/focus', room })
        );
    });
}

// Register Authentication IQ handlers
function setupAuthenticationIqHandler(xmppConnection, authenticationAuthority) {
    if (!xmppConnection.registerIqHandler || !authenticationAuthority) return;
    
    // Login URL IQ handler
    xmppConnection.registerIqHandler('login-url', 'http://jitsi.org/protocol/focus', async (iq) => {
        const loginUrlEl = iq.getChild('login-url', 'http://jitsi.org/protocol/focus');
        if (!loginUrlEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const room = loginUrlEl.attrs.room;
        const machineUID = loginUrlEl.attrs.machineUID;
        const popup = loginUrlEl.attrs.popup === 'true';
        
        if (!machineUID) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        try {
            const url = authenticationAuthority.createLoginUrl(machineUID, iq.attrs.from, room, popup);
            return xml('iq', { type: 'result', to: iq.attrs.from, id: iq.attrs.id },
                xml('login-url', { xmlns: 'http://jitsi.org/protocol/focus', url })
            );
        } catch (error) {
            logger.error('Failed to create login URL:', error);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
    });
    
    // Logout IQ handler
    xmppConnection.registerIqHandler('logout', 'http://jitsi.org/protocol/focus', async (iq) => {
        const logoutEl = iq.getChild('logout', 'http://jitsi.org/protocol/focus');
        if (!logoutEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        try {
            const result = authenticationAuthority.processLogoutIq(iq);
            return result;
        } catch (error) {
            logger.error('Failed to process logout IQ:', error);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
    });
}

// Register Mute IQ handlers
function setupMuteIqHandlers(xmppConnection, conferenceStore) {
    if (!xmppConnection.registerIqHandler) return;
    
    // Audio mute handler
    xmppConnection.registerIqHandler('mute', 'http://jitsi.org/protocol/focus', async (iq) => {
        const muteEl = iq.getChild('mute', 'http://jitsi.org/protocol/focus');
        if (!muteEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const doMute = muteEl.attrs.mute === 'true';
        const jidToMute = muteEl.attrs.jid;
        
        if (doMute === null || !jidToMute) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const conference = conferenceStore.getConference(iq.attrs.from);
        if (!conference) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        try {
            const result = conference.handleMuteRequest(iq.attrs.from, jidToMute, doMute, 'audio');
            if (result === 'SUCCESS') {
                // Send success response
                const response = xml('iq', { type: 'result', to: iq.attrs.from, id: iq.attrs.id });
                
                // If this was a remote mute, notify the participant that was muted
                if (iq.attrs.from !== jidToMute) {
                    const notifyIq = xml('iq', { type: 'set', to: jidToMute },
                        xml('mute', { xmlns: 'http://jitsi.org/protocol/focus', mute: doMute.toString(), actor: iq.attrs.from })
                    );
                    xmppConnection.send(notifyIq);
                }
                
                return response;
            } else if (result === 'NOT_ALLOWED') {
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    xml('error', { type: 'cancel' },
                        xml('not-allowed', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            } else {
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    xml('error', { type: 'cancel' },
                        xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            }
        } catch (error) {
            logger.error('Failed to handle mute request:', error);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
    });
    
    // Video mute handler
    xmppConnection.registerIqHandler('mute-video', 'http://jitsi.org/protocol/focus', async (iq) => {
        const muteEl = iq.getChild('mute-video', 'http://jitsi.org/protocol/focus');
        if (!muteEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const doMute = muteEl.attrs.mute === 'true';
        const jidToMute = muteEl.attrs.jid;
        
        if (doMute === null || !jidToMute) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const conference = conferenceStore.getConference(iq.attrs.from);
        if (!conference) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        try {
            const result = conference.handleMuteRequest(iq.attrs.from, jidToMute, doMute, 'video');
            if (result === 'SUCCESS') {
                // Send success response
                const response = xml('iq', { type: 'result', to: iq.attrs.from, id: iq.attrs.id });
                
                // If this was a remote mute, notify the participant that was muted
                if (iq.attrs.from !== jidToMute) {
                    const notifyIq = xml('iq', { type: 'set', to: jidToMute },
                        xml('mute-video', { xmlns: 'http://jitsi.org/protocol/focus', mute: doMute.toString(), actor: iq.attrs.from })
                    );
                    xmppConnection.send(notifyIq);
                }
                
                return response;
            } else if (result === 'NOT_ALLOWED') {
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    xml('error', { type: 'cancel' },
                        xml('not-allowed', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            } else {
                return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    xml('error', { type: 'cancel' },
                        xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
            }
        } catch (error) {
            logger.error('Failed to handle video mute request:', error);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
    });
}

// Register Jibri IQ handler
function setupJibriIqHandler(xmppConnection, conferenceStore) {
    if (!xmppConnection.registerIqHandler) return;
    
    xmppConnection.registerIqHandler('jibri', 'http://jitsi.org/protocol/jibri', async (iq) => {
        const jibriEl = iq.getChild('jibri', 'http://jitsi.org/protocol/jibri');
        if (!jibriEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        // Find the conference that can handle this Jibri request
        const conferences = conferenceStore.getAllConferences();
        for (const conference of conferences) {
            try {
                const result = conference.handleJibriRequest(iq);
                if (result && result.accepted) {
                    return result.response;
                }
            } catch (error) {
                logger.error('Error handling Jibri request in conference:', error);
            }
        }
        
        // No conference accepted the request
        logger.warn('Jibri IQ not accepted by any conference');
        return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
            xml('error', { type: 'cancel' },
                xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
            )
        );
    });
}

// Register Jigasi IQ handler
function setupJigasiIqHandler(xmppConnection, conferenceStore, jigasiDetector) {
    if (!xmppConnection.registerIqHandler || !jigasiDetector) return;
    
    xmppConnection.registerIqHandler('dial', 'urn:xmpp:rayo:1', async (iq) => {
        const dialEl = iq.getChild('dial', 'urn:xmpp:rayo:1');
        if (!dialEl) {
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'modify' },
                    xml('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        const conferenceJid = iq.attrs.from;
        const conference = conferenceStore.getConference(conferenceJid) || 
                         conferenceStore.getAllConferences().find(c => c.visitorRoomsJids && c.visitorRoomsJids.includes(conferenceJid));
        
        if (!conference) {
            logger.warn('Rejected Jigasi request for non-existent conference:', conferenceJid);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        if (!conference.acceptJigasiRequest(iq.attrs.from)) {
            logger.warn('Rejected Jigasi request from unauthorized user:', iq.attrs.from);
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('forbidden', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        // Check room name header
        const roomNameHeader = dialEl.getChild('header', { name: 'JvbRoomName' });
        if (roomNameHeader && roomNameHeader.text() !== conference.roomName) {
            logger.warn('Rejecting Jigasi request with non-matching JvbRoomName');
            return xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('forbidden', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }
        
        logger.info('Accepted Jigasi request from:', iq.attrs.from);
        
        // Process the Jigasi request asynchronously
        setTimeout(async () => {
            try {
                await inviteJigasi(iq, conference, jigasiDetector, xmppConnection);
            } catch (error) {
                logger.error('Failed to invite Jigasi:', error);
                const errorIq = xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                    xml('error', { type: 'cancel' },
                        xml('internal-server-error', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    )
                );
                xmppConnection.send(errorIq);
            }
        }, 0);
        
        // Return immediate acceptance
        return xml('iq', { type: 'result', to: iq.attrs.from, id: iq.attrs.id });
    });
}

// Helper function to invite Jigasi
async function inviteJigasi(iq, conference, jigasiDetector, xmppConnection, retryCount = 2, exclude = []) {
    const destination = iq.getChild('dial', 'urn:xmpp:rayo:1').attrs.destination;
    
    const selector = destination === 'jitsi_meet_transcribe' 
        ? jigasiDetector.selectTranscriber.bind(jigasiDetector)
        : jigasiDetector.selectSipJigasi.bind(jigasiDetector);
    
    // Check if transcriber already exists
    if (destination === 'jitsi_meet_transcribe' && conference.hasTranscriber()) {
        logger.warn('Request failed, transcriber already available');
        const errorIq = xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
            xml('error', { type: 'cancel' },
                xml('conflict', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
            )
        );
        xmppConnection.send(errorIq);
        return;
    }
    
    // Select Jigasi instance
    const jigasiJid = selector(exclude, conference.bridgeRegions);
    if (!jigasiJid) {
        logger.warn('Request failed, no Jigasi instances available');
        const errorIq = xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
            xml('error', { type: 'cancel' },
                xml('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
            )
        );
        xmppConnection.send(errorIq);
        return;
    }
    
    logger.info('Selected Jigasi instance:', jigasiJid);
    
    // Forward the request to the selected Jigasi instance
    const requestToJigasi = xml('iq', { type: 'set', to: jigasiJid },
        iq.getChild('dial', 'urn:xmpp:rayo:1')
    );
    
    try {
        const responseFromJigasi = await xmppConnection.sendIq(requestToJigasi);
        
        // Forward the response back to the original requester
        const responseToRequester = xml('iq', { type: 'result', to: iq.attrs.from, id: iq.attrs.id },
            responseFromJigasi.getChild('ref', 'urn:xmpp:rayo:1')
        );
        xmppConnection.send(responseToRequester);
        
    } catch (error) {
        logger.error('Failed to get response from Jigasi:', error);
        
        // Retry logic
        if (retryCount > 0) {
            const newExclude = [...exclude, jigasiJid];
            await inviteJigasi(iq, conference, jigasiDetector, xmppConnection, retryCount - 1, newExclude);
        } else {
            const errorIq = xml('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                xml('error', { type: 'cancel' },
                    xml('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
            xmppConnection.send(errorIq);
        }
    }
}

module.exports = {
    XmppServices,
    initializeSmack,
    ManagedXmppConnection
};
