// Based on XEP-0166 Jingle a standard Jingle reasons.
// The actual XML element will be <reason><[NAME]/></reason>
// where [NAME] is one of these, e.g. <success/>, <busy/>.
// The xmlns for these specific reason elements is often urn:xmpp:jingle:errors:1 for errors,
// or urn:xmpp:jingle:reasons:1 (though the former is more common for error conditions).
// For session-terminate, the <reason> element itself doesn't have a namespace, but its child does.

const JINGLE_REASON_ERRORS_NS = 'urn:xmpp:jingle:errors:1'; // Common for error conditions
const JINGLE_REASON_NORMAL_NS = 'urn:xmpp:jingle:reasons:1'; // Less commonly explicit for non-error

const JingleReason = Object.freeze({
    SUCCESS: { name: 'success', xmlns: JINGLE_REASON_NORMAL_NS }, // Successful termination
    BUSY: { name: 'busy', xmlns: JINGLE_REASON_ERRORS_NS },
    CANCEL: { name: 'cancel', xmlns: JINGLE_REASON_ERRORS_NS }, // Cancellation by initiator
    CONNECTIVITY_ERROR: { name: 'connectivity-error', xmlns: JINGLE_REASON_ERRORS_NS },
    DECLINE: { name: 'decline', xmlns: JINGLE_REASON_ERRORS_NS }, // Responder declined
    EXPIRED: { name: 'expired', xmlns: JINGLE_REASON_ERRORS_NS }, // e.g., single participant timeout
    FAILED_APPLICATION: { name: 'failed-application', xmlns: JINGLE_REASON_ERRORS_NS },
    FAILED_TRANSPORT: { name: 'failed-transport', xmlns: JINGLE_REASON_ERRORS_NS },
    GENERAL_ERROR: { name: 'general-error', xmlns: JINGLE_REASON_ERRORS_NS },
    GONE: { name: 'gone', xmlns: JINGLE_REASON_ERRORS_NS }, // Participant left MUC, etc.
    INCOMPATIBLE_PARAMETERS: { name: 'incompatible-parameters', xmlns: JINGLE_REASON_ERRORS_NS },
    MEDIA_ERROR: { name: 'media-error', xmlns: JINGLE_REASON_ERRORS_NS },
    SECURITY_ERROR: { name: 'security-error', xmlns: JINGLE_REASON_ERRORS_NS },
    TIMEOUT: { name: 'timeout', xmlns: JINGLE_REASON_ERRORS_NS }, // IQ response timeout, not session idle timeout
    UNSUPPORTED_APPLICATIONS: { name: 'unsupported-applications', xmlns: JINGLE_REASON_ERRORS_NS },
    UNSUPPORTED_TRANSPORTS: { name: 'unsupported-transports', xmlns: JINGLE_REASON_ERRORS_NS },
    ALTERNATIVE_SESSION: { name: 'alternative-session', xmlns: JINGLE_REASON_NORMAL_NS } // e.g. for call transfer
});

module.exports = {
    JingleReason,
    JINGLE_REASON_ERRORS_NS,
    JINGLE_REASON_NORMAL_NS
};
