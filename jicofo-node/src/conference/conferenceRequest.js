const logger = require('../utils/logger');

/**
 * The initial request to create or join a conference, a generic version of ConferenceIq.
 */
class ConferenceRequest {
    /**
     * @param {Object} options - The conference request options
     * @param {string} options.room - The room name
     * @param {boolean} options.ready - Whether the conference is ready
     * @param {string} options.focusJid - The focus JID
     * @param {string} options.sessionId - The session ID
     * @param {string} options.machineUid - The machine UID
     * @param {string} options.identity - The identity
     * @param {string} options.vnode - The virtual node
     * @param {Object} options.properties - Additional properties
     */
    constructor(options = {}) {
        this.room = options.room || null;
        this.ready = options.ready || null;
        this.focusJid = options.focusJid || null;
        this.sessionId = options.sessionId || null;
        this.machineUid = options.machineUid || null;
        this.identity = options.identity || null;
        this.vnode = options.vnode || null;
        this.properties = options.properties || {};
    }

    /**
     * Convert to a ConferenceIq object
     * @returns {Object} - The ConferenceIq object
     */
    toConferenceIq() {
        const iq = {};

        if (this.room) {
            iq.room = this.room;
        }
        if (this.ready !== null) {
            iq.isReady = this.ready;
        }
        if (this.focusJid) {
            iq.focusJid = this.focusJid;
        }
        if (this.sessionId) {
            iq.sessionId = this.sessionId;
        }
        if (this.machineUid) {
            iq.machineUID = this.machineUid;
        }
        if (this.identity) {
            iq.identity = this.identity;
        }
        if (this.vnode) {
            iq.vnode = this.vnode;
        }

        // Add properties
        Object.keys(this.properties).forEach(key => {
            if (!iq.properties) {
                iq.properties = {};
            }
            iq.properties[key] = this.properties[key];
        });

        return iq;
    }

    /**
     * Convert to JSON string
     * @returns {string} - JSON string representation
     */
    toJson() {
        return JSON.stringify(this);
    }

    /**
     * Create from a ConferenceIq object
     * @param {Object} iq - The ConferenceIq object
     * @returns {ConferenceRequest} - A new ConferenceRequest instance
     */
    static fromConferenceIq(iq) {
        return new ConferenceRequest({
            room: iq.room?.toString(),
            ready: iq.isReady,
            focusJid: iq.focusJid,
            sessionId: iq.sessionId,
            machineUid: iq.machineUID,
            identity: iq.identity,
            vnode: iq.vnode,
            properties: iq.propertiesMap || {}
        });
    }

    /**
     * Parse from JSON string
     * @param {string} jsonString - The JSON string
     * @returns {ConferenceRequest} - A new ConferenceRequest instance
     */
    static parseJson(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            return new ConferenceRequest(data);
        } catch (error) {
            logger.error('Error parsing ConferenceRequest JSON:', error);
            throw new Error('Invalid ConferenceRequest JSON format');
        }
    }

    /**
     * Validate the conference request
     * @returns {boolean} - True if valid
     */
    isValid() {
        return this.room && this.room.trim().length > 0;
    }

    /**
     * Get a property value
     * @param {string} key - The property key
     * @param {*} defaultValue - Default value if not found
     * @returns {*} - The property value
     */
    getProperty(key, defaultValue = null) {
        return this.properties[key] || defaultValue;
    }

    /**
     * Set a property value
     * @param {string} key - The property key
     * @param {*} value - The property value
     */
    setProperty(key, value) {
        this.properties[key] = value;
    }

    /**
     * Remove a property
     * @param {string} key - The property key
     */
    removeProperty(key) {
        delete this.properties[key];
    }
}

module.exports = ConferenceRequest; 