// Mirrors org.jitsi.jicofo.conference.source.SsrcGroupSemantics
// In Kotlin, this is likely an enum. In JS, a frozen object is a common pattern.

const SsrcGroupSemantics = Object.freeze({
    Simulcast: "SIM", // Simulcast
    Fid: "FID",       // Forward Error Correction (FEC) with RTX
    SourceSpecific: "SOURCE-SPECIFIC", // For any other source specific signaling (not standard Jingle group semantics)
    Unknown: "UNKNOWN" // Fallback for unrecognized semantics
});

// Helper function to parse from string, if needed, though direct comparison is fine.
function parseSsrcGroupSemantics(str) {
    for (const key in SsrcGroupSemantics) {
        if (SsrcGroupSemantics[key].toLowerCase() === str?.toLowerCase()) {
            return SsrcGroupSemantics[key];
        }
    }
    return SsrcGroupSemantics.Unknown;
}

module.exports = {
    SsrcGroupSemantics,
    parseSsrcGroupSemantics
};
