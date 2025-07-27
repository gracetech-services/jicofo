const logger = require('../utils/logger');

/**
 * Interface for storing and managing conferences
 */
class ConferenceStore {
    constructor() {
        this.conferences = new Map();
        this.pinnedConferences = new Map();
        this.listeners = [];
    }

    /**
     * Get a list of all conferences
     * @returns {Array} - List of all conferences
     */
    getAllConferences() {
        return Array.from(this.conferences.values());
    }

    /**
     * Get a conference for a specific JID
     * @param {string} jid - The conference JID
     * @returns {Object|null} - The conference or null if not found
     */
    getConference(jid) {
        return this.conferences.get(jid) || null;
    }

    /**
     * Get all pinned conferences
     * @returns {Array} - List of pinned conferences
     */
    getPinnedConferences() {
        const pinned = [];
        const now = Date.now();
        
        for (const [conferenceId, pinnedConf] of this.pinnedConferences) {
            if (pinnedConf.expiresAt > now) {
                pinned.push({
                    conferenceId: conferenceId,
                    jvbVersion: pinnedConf.jvbVersion,
                    expiresAt: new Date(pinnedConf.expiresAt).toISOString()
                });
            } else {
                // Remove expired pinned conference
                this.pinnedConferences.delete(conferenceId);
            }
        }
        
        return pinned;
    }

    /**
     * Pin a conference
     * @param {string} roomName - The room name
     * @param {string} jvbVersion - The JVB version
     * @param {number} durationMinutes - Duration in minutes
     */
    pinConference(roomName, jvbVersion, durationMinutes) {
        const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
        this.pinnedConferences.set(roomName, {
            jvbVersion: jvbVersion,
            expiresAt: expiresAt
        });
        
        logger.info(`Pinned conference ${roomName} with JVB version ${jvbVersion} for ${durationMinutes} minutes`);
    }

    /**
     * Unpin a conference
     * @param {string} roomName - The room name
     */
    unpinConference(roomName) {
        if (this.pinnedConferences.has(roomName)) {
            this.pinnedConferences.delete(roomName);
            logger.info(`Unpinned conference ${roomName}`);
        }
    }

    /**
     * Add a conference
     * @param {string} jid - The conference JID
     * @param {Object} conference - The conference object
     */
    addConference(jid, conference) {
        this.conferences.set(jid, conference);
        logger.info(`Added conference: ${jid}`);
    }

    /**
     * Remove a conference
     * @param {string} jid - The conference JID
     */
    removeConference(jid) {
        if (this.conferences.has(jid)) {
            this.conferences.delete(jid);
            logger.info(`Removed conference: ${jid}`);
            
            // Notify listeners
            this.listeners.forEach(listener => {
                try {
                    if (typeof listener.conferenceEnded === 'function') {
                        listener.conferenceEnded(jid);
                    }
                } catch (error) {
                    logger.error('Error notifying conference listener:', error);
                }
            });
        }
    }

    /**
     * Add a listener
     * @param {Object} listener - The listener object
     */
    addListener(listener) {
        if (listener && typeof listener.conferenceEnded === 'function') {
            this.listeners.push(listener);
        }
    }

    /**
     * Remove a listener
     * @param {Object} listener - The listener object
     */
    removeListener(listener) {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Get the number of conferences
     * @returns {number} - The number of conferences
     */
    getConferenceCount() {
        return this.conferences.size;
    }

    /**
     * Check if a conference exists
     * @param {string} jid - The conference JID
     * @returns {boolean} - True if the conference exists
     */
    hasConference(jid) {
        return this.conferences.has(jid);
    }

    /**
     * Clear all conferences
     */
    clear() {
        this.conferences.clear();
        logger.info('Cleared all conferences');
    }

    /**
     * Get conference statistics
     * @returns {Object} - Conference statistics
     */
    getStats() {
        return {
            totalConferences: this.conferences.size,
            pinnedConferences: this.pinnedConferences.size,
            listeners: this.listeners.length
        };
    }
}

/**
 * Pinned conference data class
 */
class PinnedConference {
    constructor(conferenceId, jvbVersion, expiresAt) {
        this.conferenceId = conferenceId;
        this.jvbVersion = jvbVersion;
        this.expiresAt = expiresAt;
    }
}

module.exports = {
    ConferenceStore,
    PinnedConference
}; 