const logger = require('../utils/logger');
const config = require('config'); // Uses the 'config' library

const JICOFO_CONFIG_ROOT = 'jicofo';

// TODO: Implement password redaction for sensitive keys if logged or exposed.

/**
 * Retrieves a configuration value. All keys are relative to the "jicofo" root.
 * Throws an error if the key is not found, as per 'node-config' behavior.
 * @param {string} key - The configuration key (e.g., "xmpp.client.domain").
 * @returns {*} The configuration value.
 */
function getConfig(key) {
    const fullKey = `${JICOFO_CONFIG_ROOT}.${key}`;
    if (!config.has(fullKey)) {
        // 'config.get' will throw if the key doesn't exist, which is often desired.
        // Logging a warning here might be redundant but can be useful for debugging.
        logger.warn(`Configuration key "${fullKey}" not found. 'config.get' will throw.`);
    }
    return config.get(fullKey);
}

/**
 * Retrieves an optional configuration value. All keys are relative to the "jicofo" root.
 * Returns a default value if the key is not found.
 * @param {string} key - The configuration key (e.g., "xmpp.client.resource").
 * @param {*} [defaultValue=null] - The value to return if the key is not found.
 * @returns {*} The configuration value or the default.
 */
function getOptionalConfig(key, defaultValue = null) {
    const fullKey = `${JICOFO_CONFIG_ROOT}.${key}`;
    if (config.has(fullKey)) {
        return config.get(fullKey);
    }
    logger.debug(`Optional configuration key "${fullKey}" not found, using default: ${defaultValue}`);
    return defaultValue;
}

// Example: How to check if the entire 'jicofo' block exists.
if (!config.has(JICOFO_CONFIG_ROOT)) {
    logger.error(`Critical: The root Jicofo configuration block "${JICOFO_CONFIG_ROOT}" is missing in your config files!`);
    // Depending on strictness, might throw an error here or expect services to fail gracefully.
}


// Metaconfig logging setup (if ever needed) would go here.
logger.info(`Configuration module initialized. Expecting settings under "${JICOFO_CONFIG_ROOT}" root key.`);

module.exports = {
    getConfig,
    getOptionalConfig,
    JICOFO_CONFIG_ROOT // Exporting for clarity if other modules need it, though they should use getConfig
};
