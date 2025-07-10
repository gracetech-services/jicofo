// Based on common Jitsi/Jingle XMPP features.
// Values would typically be the XMPP Service Discovery feature strings.
const Features = Object.freeze({
    // Jingle features
    ICE_UDP: "urn:xmpp:jingle:transports:ice-udp:1",
    DTLS_SRTP: "urn:xmpp:jingle:apps:rtp:dtls:0", // Or :1 depending on spec version used
    GROUPING: "urn:xmpp:jingle:apps:grouping:0", // XEP-0339
    RTCP_MUX: "urn:xmpp:jingle:apps:rtp:rtcp-mux:0",
    RTP_HDREXT: "urn:xmpp:jingle:apps:rtp:rtp-hdrext:0",

    // Jitsi specific or common WebRTC features often advertised
    SSRC_REWRITING: "http://jitsi.org/rewriting", // Example, check actual feature string if specific
    JSON_SOURCES: "http://jitsi.org/json-sources", // Example for JSON encoded sources in Jingle
    REMB: "http://jitsi.org/remb", // Example, often part of rtp-hdrext or implicit
    TCC: "http://jitsi.org/tcc", // Example, for transport-cc
    RTX: "urn:ietf:params:rtp-hdrext:rtx", // More standard way for RTX
    OPUS_RED: "http://jitsi.org/opus-red", // Example for Opus REDundancy

    AUDIO: "urn:xmpp:jingle:apps:rtp:audio", // General audio support
    VIDEO: "urn:xmpp:jingle:apps:rtp:video", // General video support

    AUDIO_MUTE: "http://jitsi.org/protocol/audio-mute", // Jitsi specific for server-side mute
    SCTP: "urn:xmpp:jingle:transports:sctp:1", // For data channels, if used directly by Jingle

    // Default set of features a "standard" Jitsi client might support
    // This is a guess and should be aligned with actual client capabilities expected.
    defaultFeatures: new Set([
        "urn:xmpp:jingle:transports:ice-udp:1",
        "urn:xmpp:jingle:apps:rtp:dtls:0",
        "urn:xmpp:jingle:apps:grouping:0",
        "urn:xmpp:jingle:apps:rtp:rtcp-mux:0",
        "urn:xmpp:jingle:apps:rtp:rtp-hdrext:0",
        "urn:xmpp:jingle:apps:rtp:audio",
        "urn:xmpp:jingle:apps:rtp:video",
        // Add more by default if applicable
    ])
});

// Helper to create a feature set from an array of strings
function createFeatureSet(featureStrings = []) {
    return new Set(featureStrings);
}

module.exports = {
    Features,
    createFeatureSet
};
