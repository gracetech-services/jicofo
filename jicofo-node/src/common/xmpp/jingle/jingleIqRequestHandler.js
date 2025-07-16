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

const { createElement } = require('@xmpp/xml');
const loggerModule = require('../../../utils/logger');

/**
 * Maintains a map of JingleSession instances and routes incoming Jingle IQs to the associated session.
 * This is the main entry point for handling Jingle protocol IQs.
 */
class JingleIqRequestHandler {
    constructor(xmppConnections) {
        this.logger = loggerModule.child({ component: 'JingleIqRequestHandler' });
        
        // Convert single connection to array if needed
        this.connections = Array.isArray(xmppConnections) ? xmppConnections : [xmppConnections];
        
        // Map of session ID to JingleSession instance
        this.sessions = new Map();
        
        this.logger.info('JingleIqRequestHandler initialized.');
    }

    /**
     * Handles incoming Jingle IQ requests.
     * @param {Object} request - The IQ request object
     * @returns {Promise<Object|null>} Response IQ or null
     */
    async handleRequest(request) {
        const iq = request.iq;
        const jingleElement = iq.getChild('jingle', 'urn:xmpp:jingle:1');
        
        if (!jingleElement) {
            this.logger.warn('Received IQ in Jingle namespace without <jingle> element.');
            return createElement('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                createElement('error', { type: 'cancel' },
                    createElement('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }

        const sid = jingleElement.attrs.sid;
        const session = this.sessions.get(sid);
        
        if (!session) {
            this.logger.warn(`No session found for SID: ${sid}`);
            return createElement('iq', { type: 'error', to: iq.attrs.from, id: iq.attrs.id },
                createElement('error', { type: 'cancel' },
                    createElement('bad-request', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                )
            );
        }

        // Delegate to the session's handler
        return session.processJingleIq(iq, jingleElement.attrs.action, jingleElement.getChildren());
    }

    /**
     * Registers a Jingle session.
     * @param {JingleSession} session - The session to register
     */
    registerSession(session) {
        if (!session || !session.sid) {
            this.logger.error('Attempted to register an invalid session.');
            return;
        }

        const existingSession = this.sessions.get(session.sid);
        if (existingSession) {
            this.logger.warn(`Replacing existing session with SID: ${session.sid}`);
        }

        this.sessions.set(session.sid, session);
        this.logger.info(`Registered Jingle session: ${session.sid}`);
    }

    /**
     * Removes a Jingle session.
     * @param {JingleSession} session - The session to remove
     */
    removeSession(session) {
        if (this.sessions.delete(session.sid)) {
            this.logger.info(`Removed Jingle session: ${session.sid}`);
        }
    }

    /**
     * Gets a session by SID.
     * @param {string} sid - The session ID
     * @returns {JingleSession|null} The session or null if not found
     */
    getSession(sid) {
        return this.sessions.get(sid) || null;
    }

    /**
     * Gets all active sessions.
     * @returns {Array<JingleSession>} Array of active sessions
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }

    /**
     * Clears all sessions.
     */
    clearAllSessions() {
        this.sessions.clear();
        this.logger.info('Cleared all Jingle sessions.');
    }

    /**
     * Gets debug state information.
     * @returns {Object} Debug state
     */
    getDebugState() {
        return {
            sessionCount: this.sessions.size,
            sessions: Array.from(this.sessions.keys())
        };
    }
}

module.exports = JingleIqRequestHandler; 