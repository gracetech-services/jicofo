// codecConfig.js
// Configuration schema and defaults for codecs and RTP header extensions, ported from Jicofo's CodecConfig.kt

class CodecConfig {
    constructor({ enabled = true, pt = 0, rtxPt = 0, minptime = 10, useInbandFec = false, red = null, enableRemb = false } = {}) {
        this.enabled = enabled;
        this.pt = pt;
        this.rtxPt = rtxPt;
        this.minptime = minptime;
        this.useInbandFec = useInbandFec;
        this.red = red;
        this.enableRemb = enableRemb;
    }
    isEnabled() { return this.enabled && this.pt > 0; }
    isRtxEnabled() { return this.isEnabled() && this.rtxPt > 0; }
}

class RtpExtensionConfig {
    constructor({ enabled = true, id = 0 } = {}) {
        this.enabled = enabled;
        this.id = id;
    }
    isEnabled() { return this.enabled; }
}

// Default config (can be loaded from file/env)
const codecConfig = {
    av1: new CodecConfig({ enabled: true, pt: 35, rtxPt: 96 }),
    vp8: new CodecConfig({ enabled: true, pt: 100, rtxPt: 96 }),
    vp9: new CodecConfig({ enabled: true, pt: 101, rtxPt: 97 }),
    h264: new CodecConfig({ enabled: true, pt: 107, rtxPt: 99 }),
    opus: new CodecConfig({ enabled: true, pt: 111, minptime: 10, useInbandFec: true, red: new CodecConfig({ enabled: true, pt: 112 }) }),
    telephoneEvent: new CodecConfig({ enabled: true, pt: 126 }),
    // RTP header extensions
    audioLevel: new RtpExtensionConfig({ enabled: true, id: 1 }),
    av1DependencyDescriptor: new RtpExtensionConfig({ enabled: true, id: 2 }),
    videoLayersAllocation: new RtpExtensionConfig({ enabled: true, id: 12 }),
    tof: new RtpExtensionConfig({ enabled: true, id: 2 }),
    absSendTime: new RtpExtensionConfig({ enabled: true, id: 3 }),
    rid: new RtpExtensionConfig({ enabled: true, id: 4 }),
    tcc: new RtpExtensionConfig({ enabled: true, id: 5 }),
    mid: new RtpExtensionConfig({ enabled: true, id: 10 }),
    videoContentType: new RtpExtensionConfig({ enabled: true, id: 13 }),
    framemarking: new RtpExtensionConfig({ enabled: true, id: 14 }),
    extmapAllowMixed: true
};

module.exports = { CodecConfig, RtpExtensionConfig, codecConfig }; 