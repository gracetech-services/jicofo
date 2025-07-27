const logger = require('../utils/logger');

/**
 * Handler for authentication-related IQ requests
 */
class AuthenticationIqHandler {
    /**
     * @param {Object} authAuthority - The authentication authority
     */
    constructor(authAuthority) {
        this.authAuthority = authAuthority;
        this.logger = logger;
    }

    /**
     * Handle a login URL IQ request
     * @param {Object} loginUrlIq - The login URL IQ
     * @returns {Object} - The response IQ
     */
    handleLoginUrlIq(loginUrlIq) {
        const peerFullJid = loginUrlIq.from;
        const roomName = loginUrlIq.room;
        
        if (!roomName) {
            return this.createNotAcceptableErrorResponse(loginUrlIq);
        }

        const popup = loginUrlIq.popup || false;
        const machineUID = loginUrlIq.machineUID;
        
        if (!machineUID || machineUID.trim() === '') {
            return this.createBadRequestErrorResponse(loginUrlIq, 'missing mandatory attribute \'machineUID\'');
        }

        const url = this.authAuthority.createLoginUrl(machineUID, peerFullJid, roomName, popup);
        
        const response = {
            type: 'result',
            stanzaId: loginUrlIq.stanzaId,
            to: loginUrlIq.from,
            url: url
        };

        this.logger.info(`Sending login URL: ${url}`);
        return response;
    }

    /**
     * Handle a logout IQ request
     * @param {Object} logoutIq - The logout IQ
     * @returns {Object} - The response IQ
     */
    handleLogoutIq(logoutIq) {
        return this.authAuthority.processLogoutIq(logoutIq);
    }

    /**
     * Process a login URL IQ request
     * @param {Object} iqRequest - The IQ request
     * @returns {Object} - The response IQ
     */
    processLoginUrlIq(iqRequest) {
        if (iqRequest.type === 'get' && iqRequest.element === 'login-url') {
            // Parse and substitute the original sender's JID if needed
            const originalFrom = iqRequest.from;
            iqRequest.from = this.parseJidFromClientProxyJid(iqRequest.from);
            
            const response = this.handleLoginUrlIq(iqRequest);
            response.to = originalFrom;
            return response;
        } else {
            this.logger.error(`Received an unexpected IQ type: ${iqRequest.type}`);
            return this.createInternalServerErrorResponse(iqRequest);
        }
    }

    /**
     * Process a logout IQ request
     * @param {Object} iqRequest - The IQ request
     * @returns {Object} - The response IQ
     */
    processLogoutIq(iqRequest) {
        if (iqRequest.type === 'set' && iqRequest.element === 'logout') {
            // Parse and substitute the original sender's JID if needed
            const originalFrom = iqRequest.from;
            iqRequest.from = this.parseJidFromClientProxyJid(iqRequest.from);
            
            const response = this.handleLogoutIq(iqRequest);
            response.to = originalFrom;
            return response;
        } else {
            this.logger.error(`Received an unexpected IQ type: ${iqRequest.type}`);
            return this.createInternalServerErrorResponse(iqRequest);
        }
    }

    /**
     * Parse JID from client proxy JID
     * @param {string} jid - The JID to parse
     * @returns {string} - The parsed JID
     */
    parseJidFromClientProxyJid(jid) {
        // This would implement the logic to parse JID from client proxy
        // For now, return the original JID
        return jid;
    }

    /**
     * Create an error response
     * @param {Object} iq - The original IQ
     * @param {string} condition - The error condition
     * @returns {Object} - The error response
     */
    createErrorResponse(iq, condition) {
        return {
            type: 'error',
            stanzaId: iq.stanzaId,
            to: iq.from,
            error: {
                condition: condition
            }
        };
    }

    /**
     * Create a not acceptable error response
     * @param {Object} iq - The original IQ
     * @returns {Object} - The error response
     */
    createNotAcceptableErrorResponse(iq) {
        return this.createErrorResponse(iq, 'not-acceptable');
    }

    /**
     * Create a bad request error response
     * @param {Object} iq - The original IQ
     * @param {string} message - The error message
     * @returns {Object} - The error response
     */
    createBadRequestErrorResponse(iq, message) {
        return {
            type: 'error',
            stanzaId: iq.stanzaId,
            to: iq.from,
            error: {
                condition: 'bad-request',
                text: message
            }
        };
    }

    /**
     * Create an internal server error response
     * @param {Object} iq - The original IQ
     * @returns {Object} - The error response
     */
    createInternalServerErrorResponse(iq) {
        return this.createErrorResponse(iq, 'internal-server-error');
    }

    /**
     * Check if this handler can handle the given IQ
     * @param {Object} iq - The IQ to check
     * @returns {boolean} - True if this handler can handle the IQ
     */
    canHandle(iq) {
        return (iq.element === 'login-url' && iq.type === 'get') ||
               (iq.element === 'logout' && iq.type === 'set');
    }

    /**
     * Handle an IQ request
     * @param {Object} iq - The IQ to handle
     * @returns {Object} - The response IQ
     */
    handle(iq) {
        if (iq.element === 'login-url' && iq.type === 'get') {
            return this.processLoginUrlIq(iq);
        } else if (iq.element === 'logout' && iq.type === 'set') {
            return this.processLogoutIq(iq);
        } else {
            this.logger.error(`Cannot handle IQ: ${iq.element} ${iq.type}`);
            return this.createInternalServerErrorResponse(iq);
        }
    }
}

module.exports = AuthenticationIqHandler; 