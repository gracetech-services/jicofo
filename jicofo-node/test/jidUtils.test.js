const assert = require('assert');
const { JidUtils } = require('../src/config/serviceConfigs'); // Adjust path as necessary

describe('JidUtils', () => {
    describe('parse', () => {
        it('should parse a full JID', () => {
            const j = JidUtils.parse('user@domain/resource');
            assert.ok(j, 'JID should be parsed');
            assert.strictEqual(j.local, 'user');
            assert.strictEqual(j.domain, 'domain');
            assert.strictEqual(j.resource, 'resource');
        });

        it('should parse a bare JID', () => {
            const j = JidUtils.parse('user@domain');
            assert.ok(j, 'JID should be parsed');
            assert.strictEqual(j.local, 'user');
            assert.strictEqual(j.domain, 'domain');
            assert.strictEqual(j.resource, null); // @xmpp/jid sets resource to null for bare JIDs
        });

        it('should parse a domain JID', () => {
            const j = JidUtils.parse('domain.com');
            assert.ok(j, 'JID should be parsed');
            assert.strictEqual(j.local, null); // @xmpp/jid sets local to null for domain JIDs
            assert.strictEqual(j.domain, 'domain.com');
            assert.strictEqual(j.resource, null);
        });

        it('should return null for invalid JID string', () => {
            const j = JidUtils.parse('invalid jid');
            assert.strictEqual(j, null);
        });

        it('should return null for empty string', () => {
            const j = JidUtils.parse('');
            assert.strictEqual(j, null);
        });
         it('should return null for null input', () => {
            const j = JidUtils.parse(null);
            assert.strictEqual(j, null);
        });
    });

    describe('entityBareFrom', () => {
        it('should return bare JID for full JID', () => {
            assert.strictEqual(JidUtils.entityBareFrom('user@domain/resource'), 'user@domain');
        });
        it('should return bare JID for bare JID', () => {
            assert.strictEqual(JidUtils.entityBareFrom('user@domain'), 'user@domain');
        });
        it('should return domain for domain JID', () => {
            assert.strictEqual(JidUtils.entityBareFrom('domain.com'), 'domain.com');
        });
        it('should return null for invalid JID', () => {
            assert.strictEqual(JidUtils.entityBareFrom('invalid jid string'), null);
        });
    });

    describe('domainBareFrom', () => { // Note: @xmpp/jid's jid.domain returns the domain directly
        it('should return domain for full JID', () => {
            assert.strictEqual(JidUtils.domainBareFrom('user@domain.com/resource'), 'domain.com');
        });
        it('should return domain for bare JID', () => {
            assert.strictEqual(JidUtils.domainBareFrom('user@domain.com'), 'domain.com');
        });
        it('should return domain for domain JID', () => {
            assert.strictEqual(JidUtils.domainBareFrom('domain.com'), 'domain.com');
        });
         it('should return null for invalid JID', () => {
            assert.strictEqual(JidUtils.domainBareFrom('invalid jid string'), null);
        });
    });

    describe('getLocalPart', () => {
        it('should get local part from full JID', () => {
            assert.strictEqual(JidUtils.getLocalPart('user@domain/resource'), 'user');
        });
        it('should return null if no local part', () => {
            assert.strictEqual(JidUtils.getLocalPart('domain.com'), null);
        });
    });

    describe('getResourcePart', () => {
        it('should get resource part from full JID', () => {
            assert.strictEqual(JidUtils.getResourcePart('user@domain/resource'), 'resource');
        });
        it('should return null if no resource part', () => {
            assert.strictEqual(JidUtils.getResourcePart('user@domain'), null);
        });
    });

    describe('bareEq', () => {
        it('should return true for equal bare JIDs', () => {
            assert.ok(JidUtils.bareEq('user@domain/res1', 'user@domain/res2'));
            assert.ok(JidUtils.bareEq('user@domain', 'user@domain/res2'));
            assert.ok(JidUtils.bareEq('user@domain/res1', 'user@domain'));
            assert.ok(JidUtils.bareEq('user@domain', 'user@domain'));
        });
        it('should return false for different bare JIDs', () => {
            assert.strictEqual(JidUtils.bareEq('user1@domain/res1', 'user2@domain/res2'), false);
            assert.strictEqual(JidUtils.bareEq('user@domain1', 'user@domain2'), false);
        });
        it('should handle domain JIDs correctly', () => {
            assert.ok(JidUtils.bareEq('domain.com', 'domain.com'));
            assert.strictEqual(JidUtils.bareEq('user@domain.com', 'domain.com'), false);
        });
         it('should return false for invalid JIDs', () => {
            assert.strictEqual(JidUtils.bareEq('invalid1', 'user@domain'), false);
            assert.strictEqual(JidUtils.bareEq('user@domain', 'invalid2'), false);
            assert.strictEqual(JidUtils.bareEq('invalid1', 'invalid2'), false);
        });
    });

    describe('fullEq', () => {
        it('should return true for equal full JIDs', () => {
            assert.ok(JidUtils.fullEq('user@domain/res1', 'user@domain/res1'));
        });
        it('should return false for different resources', () => {
            assert.strictEqual(JidUtils.fullEq('user@domain/res1', 'user@domain/res2'), false);
        });
        it('should return false if one has resource and other does not', () => {
            assert.strictEqual(JidUtils.fullEq('user@domain/res1', 'user@domain'), false);
            assert.strictEqual(JidUtils.fullEq('user@domain', 'user@domain/res1'), false);
        });
        it('should return true for equal bare JIDs if both are bare', () => {
            assert.ok(JidUtils.fullEq('user@domain', 'user@domain'));
        });
        it('should handle domain JIDs correctly', () => {
            assert.ok(JidUtils.fullEq('domain.com', 'domain.com'));
            assert.strictEqual(JidUtils.fullEq('user@domain.com', 'domain.com'), false);
        });
    });
});

// Simple test runner
function runTests() {
    console.log("Running JidUtils Tests...");
    try {
        // This is a bit of a hack for basic test running without a test framework
        // In a real setup, a test runner (Jest, Mocha) would handle this.
        // For now, we rely on describe/it being called and assert throwing on failure.
        // To make this actually run, we'd need to invoke the describe blocks or export/call.
        // A better simple way: collect all test functions and run them.

        // This is just a structure. To run: `node test/jidUtils.test.js`
        // and have the describe/it blocks execute. For that, they need to be
        // part of a self-executing structure or called by a runner.
        // For now, this file mostly defines the tests.
        // A simple way to make them runnable:
        // if (require.main === module) {
        //     // Manually call test cases or use a very simple runner
        // }
        // For now, assume a test runner like Mocha would be used: `mocha test/jidUtils.test.js`
        console.log("JidUtils tests defined. Run with a test runner (e.g., Mocha).");
    } catch (error) {
        console.error("Test failed:", error);
    }
}

// runTests(); // Don't auto-run like this without a proper runner structure
