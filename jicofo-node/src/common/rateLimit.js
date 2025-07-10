const logger = require('../utils/logger'); // Assuming logger might be useful, or remove if not

const DEFAULT_MIN_INTERVAL_MS = 10 * 1000; // 10 seconds
const DEFAULT_MAX_REQUESTS = 3;
const DEFAULT_INTERVAL_MS = 60 * 1000; // 60 seconds

class RateLimit {
    /**
     * @param {object} options
     * @param {number} [options.minIntervalMs=10000] - Minimum interval in milliseconds between requests.
     * @param {number} [options.maxRequests=3] - Maximum number of requests allowed within the interval.
     * @param {number} [options.intervalMs=60000] - The interval in milliseconds for maxRequests.
     * @param {object} [options.clock=Date] - Clock object with a now() method returning ms timestamp.
     */
    constructor({
        minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
        maxRequests = DEFAULT_MAX_REQUESTS,
        intervalMs = DEFAULT_INTERVAL_MS,
        clock = Date // Standard Date object provides Date.now()
    } = {}) {
        this.minIntervalMs = minIntervalMs;
        this.maxRequests = maxRequests;
        this.intervalMs = intervalMs;
        this.clock = clock;

        /** @type {number[]} Stores timestamps of accepted requests. */
        this.requests = []; // Using an array as a deque (push to add, filter to remove old)
    }

    /**
     * Determines if a new request should be accepted based on rate limiting rules.
     * @returns {boolean} True if the request is accepted, false otherwise.
     */
    accept() {
        const now = this.clock.now();

        const previousRequest = this.requests.length > 0 ? this.requests[this.requests.length - 1] : null;

        if (previousRequest === null) {
            this.requests.push(now);
            return true;
        }

        if ((now - previousRequest) < this.minIntervalMs) {
            // logger.debug('RateLimit: Rejected due to minInterval.');
            return false;
        }

        // Remove requests older than the current interval window
        const relevantPastTime = now - this.intervalMs;
        this.requests = this.requests.filter(timestamp => timestamp > relevantPastTime);

        if (this.requests.length >= this.maxRequests) {
            // logger.debug(`RateLimit: Rejected due to maxRequests. Count: ${this.requests.length}`);
            return false;
        }

        this.requests.push(now);
        return true;
    }
}

module.exports = RateLimit;
