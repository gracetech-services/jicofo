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

/**
 * Interface for handling Jingle protocol requests.
 * This defines the contract that implementations must follow.
 */
class JingleRequestHandler {
    /**
     * A 'source-add' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Array} contents - List of content elements
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onAddSource(jingleSession, contents) {
        return null;
    }

    /**
     * A 'source-remove' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Array} contents - List of content elements
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onRemoveSource(jingleSession, contents) {
        return null;
    }

    /**
     * A 'session-accept' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Array} contents - List of content elements
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onSessionAccept(jingleSession, contents) {
        return null;
    }

    /**
     * A 'session-info' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Object} iq - The Jingle IQ stanza
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onSessionInfo(jingleSession, iq) {
        return null;
    }

    /**
     * A 'session-terminate' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Object} iq - The Jingle IQ stanza
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onSessionTerminate(jingleSession, iq) {
        return null;
    }

    /**
     * A 'transport-info' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Array} contents - List of content elements
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onTransportInfo(jingleSession, contents) {
        return null;
    }

    /**
     * A 'transport-accept' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Array} contents - List of content elements
     * @returns {Promise<Object|null>} Error stanza part or null if successful
     */
    async onTransportAccept(jingleSession, contents) {
        return null;
    }

    /**
     * A 'transport-reject' IQ was received.
     * @param {JingleSession} jingleSession - The Jingle session
     * @param {Object} iq - The Jingle IQ stanza
     */
    async onTransportReject(jingleSession, iq) {
        // Default implementation does nothing
    }
}

/**
 * No-op implementation of JingleRequestHandler.
 * Useful for testing or when no specific handling is needed.
 */
class NoOpJingleRequestHandler extends JingleRequestHandler {
    // All methods use the default implementations from the base class
}

module.exports = {
    JingleRequestHandler,
    NoOpJingleRequestHandler
}; 