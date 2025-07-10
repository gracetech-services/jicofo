const assert = require('assert');
const RateLimit = require('../src/common/rateLimit'); // Adjust path as necessary

// Mock clock for precise time control in tests
class MockClock {
    constructor(initialTime = 0) {
        this.currentTime = initialTime;
    }
    now() {
        return this.currentTime;
    }
    advance(ms) {
        this.currentTime += ms;
    }
    setTime(ms) {
        this.currentTime = ms;
    }
}

describe('RateLimit', () => {
    let clock;

    beforeEach(() => {
        clock = new MockClock();
    });

    it('should accept the first request', () => {
        const limiter = new RateLimit({ clock });
        assert.ok(limiter.accept(), 'First request should be accepted');
    });

    it('should reject request if minInterval not passed', () => {
        const minIntervalMs = 100;
        const limiter = new RateLimit({ minIntervalMs, clock });

        assert.ok(limiter.accept(), 'First request accepted'); // time = 0

        clock.advance(minIntervalMs / 2); // time = 50
        assert.strictEqual(limiter.accept(), false, 'Second request too soon should be rejected');

        clock.advance(minIntervalMs / 2); // time = 100
        assert.ok(limiter.accept(), 'Third request after minInterval should be accepted');
    });

    it('should reject if maxRequests exceeded within interval', () => {
        const maxRequests = 2;
        const intervalMs = 1000;
        const minIntervalMs = 10; // Ensure minInterval doesn't interfere much
        const limiter = new RateLimit({ maxRequests, intervalMs, minIntervalMs, clock });

        assert.ok(limiter.accept(), 'Request 1 accepted'); // time = 0
        clock.advance(minIntervalMs + 1); // time = 11
        assert.ok(limiter.accept(), 'Request 2 accepted'); // time = 11

        clock.advance(minIntervalMs + 1); // time = 22
        assert.strictEqual(limiter.accept(), false, 'Request 3 (over limit) should be rejected');
    });

    it('should accept requests again after interval resets for maxRequests', () => {
        const maxRequests = 2;
        const intervalMs = 1000;
        const minIntervalMs = 10;
        const limiter = new RateLimit({ maxRequests, intervalMs, minIntervalMs, clock });

        // Fill up the request window
        assert.ok(limiter.accept(), 'Request 1'); // time = 0
        clock.advance(minIntervalMs + 1); // time = 11
        assert.ok(limiter.accept(), 'Request 2'); // time = 11

        // Try one more, should be rejected
        clock.advance(minIntervalMs + 1); // time = 22
        assert.strictEqual(limiter.accept(), false, 'Request 3 (rejected)');

        // Advance time past the interval of the first request
        clock.setTime(intervalMs + 1); // time = 1001 (first request at t=0 is now outside window)
        assert.ok(limiter.accept(), 'Request 4 (after interval reset) should be accepted');
        // Now we have requests at t=11 and t=1001. Request at t=11 is still within new window starting from t=1.

        clock.advance(minIntervalMs +1); // time = 1013
        // Request at t=11 is still within its interval relative to 1013, so we've used 2 slots.
        assert.strictEqual(limiter.accept(), false, 'Request 5 (should be rejected as request at t=11 is still counted)');

        // Advance so that request at t=11 also expires from any window starting now
        clock.setTime(11 + intervalMs + 1); // time = 1012 + 1 = 1013. Set to 1012 + 1 = 1013
                                        // No, should be 11 (time of 2nd req) + 1000 (interval) + 1 = 1012
        clock.setTime(11 + intervalMs +1); // time = 1012
        assert.ok(limiter.accept(), 'Request 6 (after 2nd request interval reset) should be accepted');
    });

    it('should handle requests exactly at interval boundary correctly', () => {
        const maxRequests = 1;
        const intervalMs = 100;
        const minIntervalMs = 10;
        const limiter = new RateLimit({ maxRequests, intervalMs, minIntervalMs, clock });

        assert.ok(limiter.accept(), 'Request 1 at t=0'); // time = 0

        clock.advance(intervalMs); // time = 100
        // The request at t=0 is now exactly at the boundary.
        // `timestamp > relevantPastTime` means it's removed.
        // `relevantPastTime = now - intervalMs = 100 - 100 = 0`.
        // `requests.filter(timestamp => timestamp > 0)` will keep the request at t=0 if it was exactly 0.
        // Let's adjust the logic in RateLimit.js: `timestamp >= relevantPastTime` to keep it,
        // or `timestamp > relevantPastTime` to expire it.
        // Kotlin: `requests.removeIf { Duration.between(it, now) > interval }`
        // This means `now - it > interval`, or `it < now - interval`.
        // So, `it < relevantPastTime`. Filter keeps `it >= relevantPastTime`.
        // If `it = 0`, `relevantPastTime = 0`, `0 >= 0` is true. So it's kept.
        assert.strictEqual(limiter.accept(), false, 'Request 2 at t=100 (boundary, should be rejected)');

        clock.advance(1); // time = 101
        // Now `relevantPastTime = 101 - 100 = 1`. Request at t=0 is removed.
        assert.ok(limiter.accept(), 'Request 3 at t=101 (after boundary, should be accepted)');
    });

    it('should respect minInterval even if maxRequests allows more', () => {
        const minIntervalMs = 200;
        const maxRequests = 5; // High max requests
        const intervalMs = 1000;
        const limiter = new RateLimit({ minIntervalMs, maxRequests, intervalMs, clock });

        assert.ok(limiter.accept(), 'Request 1'); // time = 0
        clock.advance(minIntervalMs / 2); // time = 100
        assert.strictEqual(limiter.accept(), false, 'Request 2 (violates minInterval)');

        clock.advance(minIntervalMs / 2 + 1); // time = 201
        assert.ok(limiter.accept(), 'Request 3 (respects minInterval)');
    });

    it('should work with default settings', () => {
        const limiter = new RateLimit({ clock }); // Uses defaults
        // Quick check, not exhaustive for defaults
        assert.ok(limiter.accept());
    });
});

// To run: `mocha test/rateLimit.test.js` (after installing Mocha)
// Or a simple runner:
// if (require.main === module) {
//     console.log("Running RateLimit Tests (basic runner)...");
//     // Find all functions in describe blocks and run them. More complex for a simple script.
//     console.log("RateLimit tests defined. Run with a test runner (e.g., Mocha).");
// }
