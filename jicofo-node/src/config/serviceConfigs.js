// Placeholder for individual service configurations (BridgeConfig, JibriConfig, etc.)
// In Node.js with the 'config' library, these would typically be sections in your config files (e.g., default.json).

const { getConfig, getOptionalConfig } = require('./index'); // Main config loader
const logger = require('../utils/logger');
const { jid, JID } = require('@xmpp/jid'); // Using @xmpp/jid library

const nodeConfig = require('config'); // Direct import for 'has' check
const { JICOFO_CONFIG_ROOT } = require('./index');

// Helper to extract a sub-configuration object for a service
function getServiceConfig(serviceKey) {
    const fullServiceKey = `${JICOFO_CONFIG_ROOT}.${serviceKey}`;
    if (!nodeConfig.has(fullServiceKey)) {
        logger.warn(`Configuration section for service "${serviceKey}" (expected at "${fullServiceKey}") not found. Services should handle defaults or fail if critical.`);
        return {}; // Return empty object if service config section is missing
    }
    // getConfig from ./index.js already prepends JICOFO_CONFIG_ROOT
    return getConfig(serviceKey);
}

// Wrapper for @xmpp/jid functions to provide a similar interface to JidCreate
// and handle potential errors from invalid JID strings.
const JidUtils = {
    parse: (jidString) => {
        if (!jidString) return null;
        try {
            return jid(jidString);
        } catch (e) {
            logger.warn(`Invalid JID string provided: "${jidString}". Error: ${e.message}`);
            return null;
        }
    },
    domainBareFrom: (jidString) => {
        const parsedJid = JidUtils.parse(jidString);
        return parsedJid ? parsedJid.domain : null;
    },
    entityBareFrom: (jidString) => {
        const parsedJid = JidUtils.parse(jidString);
        return parsedJid ? parsedJid.bare().toString() : null;
    },
    getLocalPart: (jidString) => {
        const parsedJid = JidUtils.parse(jidString);
        return parsedJid ? parsedJid.local : null;
    },
    getResourcePart: (jidString) => {
        const parsedJid = JidUtils.parse(jidString);
        return parsedJid ? parsedJid.resource : null;
    },
    /**
     * Checks if two JIDs are equivalent at the bare JID level.
     * @param {string | JID} jid1 First JID (string or JID object).
     * @param {string | JID} jid2 Second JID (string or JID object).
     * @returns {boolean} True if their bare JIDs are equal, false otherwise.
     */
    bareEq: (jid1, jid2) => {
        if (!jid1 || !jid2) return false;
        const pJid1 = (typeof jid1 === 'string') ? JidUtils.parse(jid1) : jid1;
        const pJid2 = (typeof jid2 === 'string') ? JidUtils.parse(jid2) : jid2;
        if (!pJid1 || !pJid2) return false;
        return pJid1.bare().equals(pJid2.bare());
    },
    /**
     * Checks if two JIDs are fully equal (including resource part).
     * @param {string | JID} jid1 First JID (string or JID object).
     * @param {string | JID} jid2 Second JID (string or JID object).
     * @returns {boolean} True if their full JIDs are equal, false otherwise.
     */
    fullEq: (jid1, jid2) => {
        if (!jid1 || !jid2) return false;
        const pJid1 = (typeof jid1 === 'string') ? JidUtils.parse(jid1) : jid1;
        const pJid2 = (typeof jid2 === 'string') ? JidUtils.parse(jid2) : jid2;
        if (!pJid1 || !pJid2) return false;
        return pJid1.equals(pJid2);
    }
};


const AuthConfig = {
    get config() {
        const authConf = getServiceConfig('auth');
        return {
            type: authConf.type || 'NONE', // NONE, XMPP, JWT
            enableAutoLogin: authConf.enableAutoLogin === true,
            authenticationLifetime: authConf.authenticationLifetime || (3600 * 1000), // 1 hour in ms
            loginUrl: authConf.loginUrl || '', // This is expected to be a domain or a URL containing it
            get loginDomainBareJid() { // This getter now uses JidUtils
                // If loginUrl is a full URL, we might need to extract the hostname first.
                // Assuming loginUrl is intended to be a domain or a JID-like string for now.
                return JidUtils.domainBareFrom(this.loginUrl) || this.loginUrl; // Fallback to raw if not parsable as JID domain
            }
        };
    }
};

const BridgeConfig = {
    get config() {
        const bridgeConf = getServiceConfig('bridge');
        return {
            healthChecksEnabled: bridgeConf.healthChecksEnabled !== false, // Default to true
            breweryJid: JidUtils.entityBareFrom(bridgeConf.breweryJid) || null, // e.g., "jvbbrewery.example.com"
            xmppConnectionName: bridgeConf.xmppConnectionName || 'service'
        };
    }
};

const JibriConfig = {
    get config() {
        const jibriConf = getServiceConfig('jibri');
        return {
            breweryJid: JidUtils.entityBareFrom(jibriConf.breweryJid) || null,
            sipBreweryJid: JidUtils.entityBareFrom(jibriConf.sipBreweryJid) || null,
            xmppConnectionName: jibriConf.xmppConnectionName || 'client'
        };
    }
};

const HealthConfig = {
    get config() {
        const healthConf = getServiceConfig('health');
        return {
            enabled: healthConf.enabled !== false,
            interval: healthConf.interval || 10000, // ms
            timeout: healthConf.timeout || 5000, // ms
            maxPeriod: healthConf.maxPeriod || 30000 //ms
        };
    }
};

const RestConfig = {
    get config() {
        const restConf = getServiceConfig('rest');
        return {
            enabled: restConf.enabled !== false,
            port: restConf.port || 8080,
            host: restConf.host || '0.0.0.0'
        };
    }
};

const defaultJingleConfig = {
  codecs: {
    audio: [
      {
        id: 111,
        name: 'opus',
        clockrate: 48000,
        channels: 2,
        parameters: { minptime: 10, useinbandfec: 1 },
        feedback: [
          { type: 'transport-cc' }
        ]
      },
      {
        id: 126,
        name: 'telephone-event',
        clockrate: 8000
      }
    ],
    video: [
      {
        id: 100,
        name: 'VP8',
        clockrate: 90000,
        feedback: [
          { type: 'ccm', subtype: 'fir' },
          { type: 'nack' },
          { type: 'nack', subtype: 'pli' },
          { type: 'goog-remb' },
          { type: 'transport-cc' }
        ]
      },
      {
        id: 101,
        name: 'rtx',
        clockrate: 90000,
        parameters: { apt: 100 }
      }
    ]
  },
  rtpHdrExts: {
    audio: [
      { id: 1, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
      { id: 10, uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' },
      { id: 5, uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01' }
    ],
    video: [
      { id: 2, uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' },
      { id: 10, uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' },
      { id: 3, uri: 'http://www.webrtc.org/experiments/rtp-hdrext/video-content-type' },
      { id: 4, uri: 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id' },
      { id: 5, uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01' }
    ]
  }
};

// Export or merge this into your config system as needed
module.exports.defaultJingleConfig = defaultJingleConfig;

module.exports = {
    AuthConfig,
    BridgeConfig,
    JibriConfig,
    HealthConfig,
    RestConfig,
    JidUtils // Exporting the new JID utility object
};
