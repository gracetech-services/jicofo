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

/**
 * Jingle protocol actions.
 */
const JingleAction = Object.freeze({
    SESSION_INITIATE: "session-initiate",
    SESSION_ACCEPT: "session-accept",
    SESSION_TERMINATE: "session-terminate",
    SESSION_INFO: "session-info",
    TRANSPORT_REPLACE: "transport-replace",
    TRANSPORT_ACCEPT: "transport-accept",
    TRANSPORT_REJECT: "transport-reject",
    TRANSPORT_INFO: "transport-info",
    ADDSOURCE: "addsource",
    SOURCEADD: "source-add",
    REMOVESOURCE: "removesource",
    SOURCEREMOVE: "source-remove",
});

/**
 * Jingle session states.
 */
const State = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    ENDED: 'ended'
});

/**
 * Jingle reason namespaces.
 */
const JINGLE_REASON_NORMAL_NS = 'urn:xmpp:jingle:1';
const JINGLE_REASON_ERRORS_NS = 'urn:xmpp:jingle:errors:1';

/**
 * Common Jingle reasons.
 */
const JingleReason = Object.freeze({
    SUCCESS: { name: 'success', xmlns: JINGLE_REASON_NORMAL_NS },
    BUSY: { name: 'busy', xmlns: JINGLE_REASON_NORMAL_NS },
    DECLINE: { name: 'decline', xmlns: JINGLE_REASON_NORMAL_NS },
    CANCEL: { name: 'cancel', xmlns: JINGLE_REASON_NORMAL_NS },
    EXPIRED: { name: 'expired', xmlns: JINGLE_REASON_NORMAL_NS },
    FAILED_APPLICATION: { name: 'failed-application', xmlns: JINGLE_REASON_ERRORS_NS },
    FAILED_TRANSPORT: { name: 'failed-transport', xmlns: JINGLE_REASON_ERRORS_NS },
    GENERAL_ERROR: { name: 'general-error', xmlns: JINGLE_REASON_ERRORS_NS },
    IMPROPER_ADDRESS: { name: 'improper-address', xmlns: JINGLE_REASON_ERRORS_NS },
    MEDIA_ERROR: { name: 'media-error', xmlns: JINGLE_REASON_ERRORS_NS },
    SECURITY_ERROR: { name: 'security-error', xmlns: JINGLE_REASON_ERRORS_NS },
    UNSUPPORTED_TRANSPORTS: { name: 'unsupported-transports', xmlns: JINGLE_REASON_ERRORS_NS }
});

module.exports = {
    JingleAction,
    State,
    JingleReason,
    JINGLE_REASON_NORMAL_NS,
    JINGLE_REASON_ERRORS_NS
}; 