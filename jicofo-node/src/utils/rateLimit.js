const logger = require('./logger');

/**
 * Rate limiting which works as follows:
 * - must be at least minInterval gap between the requests
 * - no more than maxRequests requests within the interval
 */
class RateLimit {
    /**
     * @param {number} minInterval - Never accept a request unless at least minInterval has passed since the last request (in ms)
     * @param {number} maxRequests - Accept at most maxRequests per interval
     * @param {number} interval - Accept at most maxRequests per interval (in ms)
     */
    constructor(minInterval = 10000, maxRequests = 3, interval = 60000) {
        this.minInterval = minInterval;
        this.maxRequests = maxRequests;
        this.interval = interval;
        this.requests = []; // Stores the timestamps of requests that have been received
    }

    /**
     * Return true if the request should be accepted and false otherwise.
     * @returns {boolean}
     */
    accept() {
        const now = Date.now();
        const previousRequest = this.requests.length > 0 ? this.requests[this.requests.length - 1] : null;
        
        if (previousRequest === null) {
            this.requests.push(now);
            return true;
        }

        if (now - previousRequest < this.minInterval) {
            return false;
        }

        // Allow only maxRequests requests within the last interval
        this.requests = this.requests.filter(timestamp => now - timestamp <= this.interval);
        
        if (this.requests.length >= this.maxRequests) {
            return false;
        }
        
        this.requests.push(now);
        return true;
    }

    /**
     * Get the number of requests in the current window
     * @returns {number}
     */
    getCurrentRequestCount() {
        const now = Date.now();
        this.requests = this.requests.filter(timestamp => now - timestamp <= this.interval);
        return this.requests.length;
    }

    /**
     * Get the time until the next request can be made
     * @returns {number} Time in milliseconds, or 0 if a request can be made immediately
     */
    getTimeUntilNextRequest() {
        if (this.requests.length === 0) {
            return 0;
        }

        const now = Date.now();
        const lastRequest = this.requests[this.requests.length - 1];
        const timeSinceLastRequest = now - lastRequest;
        
        if (timeSinceLastRequest >= this.minInterval) {
            return 0;
        }
        
        return this.minInterval - timeSinceLastRequest;
    }

    /**
     * Clear all stored request timestamps
     */
    clear() {
        this.requests = [];
    }
}

module.exports = RateLimit; 