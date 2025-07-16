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

const loggerModule = require('../../../utils/logger');

/**
 * Tracks Jingle protocol statistics and metrics.
 * Similar to the Kotlin JingleStats class.
 */
class JingleStats {
    constructor() {
        this.logger = loggerModule.child({ component: 'JingleStats' });
        
        // Counters for different Jingle actions
        this.stanzaCounts = {
            received: new Map(),
            sent: new Map()
        };
        
        // Session statistics
        this.sessionStats = {
            active: 0,
            total: 0,
            failed: 0,
            successful: 0
        };
        
        // Transport statistics
        this.transportStats = {
            replaces: 0,
            failures: 0,
            successes: 0
        };
        
        // Source signaling statistics
        this.sourceStats = {
            adds: 0,
            removes: 0,
            failures: 0
        };
        
        this.logger.info('JingleStats initialized.');
    }

    /**
     * Records a received Jingle stanza.
     * @param {string} action - The Jingle action (e.g., 'session-initiate', 'session-accept')
     */
    stanzaReceived(action) {
        const current = this.stanzaCounts.received.get(action) || 0;
        this.stanzaCounts.received.set(action, current + 1);
        
        this.logger.debug(`Jingle stanza received: ${action}`);
    }

    /**
     * Records a sent Jingle stanza.
     * @param {string} action - The Jingle action (e.g., 'session-initiate', 'session-accept')
     */
    stanzaSent(action) {
        const current = this.stanzaCounts.sent.get(action) || 0;
        this.stanzaCounts.sent.set(action, current + 1);
        
        this.logger.debug(`Jingle stanza sent: ${action}`);
    }

    /**
     * Records a session state change.
     * @param {string} event - The session event ('created', 'active', 'ended', 'failed')
     */
    sessionEvent(event) {
        switch (event) {
            case 'created':
                this.sessionStats.total++;
                break;
            case 'active':
                this.sessionStats.active++;
                this.sessionStats.successful++;
                break;
            case 'ended':
                this.sessionStats.active = Math.max(0, this.sessionStats.active - 1);
                break;
            case 'failed':
                this.sessionStats.failed++;
                break;
        }
        
        this.logger.debug(`Jingle session event: ${event}`);
    }

    /**
     * Records a transport replace event.
     * @param {boolean} success - Whether the transport replace was successful
     */
    transportReplace(success) {
        this.transportStats.replaces++;
        if (success) {
            this.transportStats.successes++;
        } else {
            this.transportStats.failures++;
        }
        
        this.logger.debug(`Transport replace: ${success ? 'success' : 'failure'}`);
    }

    /**
     * Records a source signaling event.
     * @param {string} action - The source action ('add', 'remove')
     * @param {boolean} success - Whether the action was successful
     */
    sourceEvent(action, success) {
        if (action === 'add') {
            this.sourceStats.adds++;
        } else if (action === 'remove') {
            this.sourceStats.removes++;
        }
        
        if (!success) {
            this.sourceStats.failures++;
        }
        
        this.logger.debug(`Source ${action}: ${success ? 'success' : 'failure'}`);
    }

    /**
     * Gets the current statistics as a JSON object.
     * @returns {Object} The statistics object
     */
    getStats() {
        return {
            stanzas: {
                received: Object.fromEntries(this.stanzaCounts.received),
                sent: Object.fromEntries(this.stanzaCounts.sent)
            },
            sessions: this.sessionStats,
            transport: this.transportStats,
            sources: this.sourceStats
        };
    }

    /**
     * Resets all statistics.
     */
    reset() {
        this.stanzaCounts.received.clear();
        this.stanzaCounts.sent.clear();
        this.sessionStats = {
            active: 0,
            total: 0,
            failed: 0,
            successful: 0
        };
        this.transportStats = {
            replaces: 0,
            failures: 0,
            successes: 0
        };
        this.sourceStats = {
            adds: 0,
            removes: 0,
            failures: 0
        };
        
        this.logger.info('JingleStats reset.');
    }

    /**
     * Gets debug information.
     * @returns {Object} Debug information
     */
    getDebugInfo() {
        return {
            stats: this.getStats(),
            timestamp: new Date().toISOString()
        };
    }
}

// Create a singleton instance
const jingleStatsInstance = new JingleStats();

module.exports = {
    JingleStats,
    jingleStatsInstance
}; 