/**
 * Enum for reinvite methods
 */
const ReinviteMethod = {
    RestartJingle: 'RestartJingle',
    ReplaceTransport: 'ReplaceTransport'
};

/**
 * Check if a value is a valid ReinviteMethod
 * @param {string} value - The value to check
 * @returns {boolean} - True if valid
 */
function isValidReinviteMethod(value) {
    return Object.values(ReinviteMethod).includes(value);
}

/**
 * Get all available reinvite methods
 * @returns {Array} - Array of all reinvite methods
 */
function getAllReinviteMethods() {
    return Object.values(ReinviteMethod);
}

/**
 * Get the default reinvite method
 * @returns {string} - The default method
 */
function getDefaultReinviteMethod() {
    return ReinviteMethod.RestartJingle;
}

module.exports = {
    ReinviteMethod,
    isValidReinviteMethod,
    getAllReinviteMethods,
    getDefaultReinviteMethod
}; 