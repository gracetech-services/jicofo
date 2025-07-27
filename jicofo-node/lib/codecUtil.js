// codecUtil.js
// Utility functions for codec payload types, RTP header extensions, and feedback, ported from CodecUtil.kt

const { codecConfig } = require('./codecConfig');
const OfferOptions = require('./offerOptions');

// Helper: PayloadType, Parameter, RtcpFb, RTPHdrExt objects
class PayloadType {
    constructor({ id, name, clockrate, channels = 1, parameters = [], rtcpFeedback = [] }) {
        this.id = id;
        this.name = name;
        this.clockrate = clockrate;
        this.channels = channels;
        this.parameters = parameters;
        this.rtcpFeedback = rtcpFeedback;
    }
    addParameter(name, value) { this.parameters.push({ name, value }); }
    addRtcpFeedback(type, subtype) { this.rtcpFeedback.push({ type, subtype }); }
}

class RTPHdrExt {
    constructor({ id, uri }) {
        this.id = id;
        this.uri = uri;
    }
}

// Feedback helpers
function createRtcpFb(type, subtype) {
    return { type, subtype };
}

// PayloadType helpers
function createPayloadType({ id, name, clockrate, channels = 1 }) {
    return new PayloadType({ id, name, clockrate, channels });
}

function addVideoExtensions(pt, options, codecCfg) {
    pt.addRtcpFeedback('ccm', 'fir');
    pt.addRtcpFeedback('nack', null);
    pt.addRtcpFeedback('nack', 'pli');
    if (codecCfg.enableRemb && options.remb) {
        pt.addRtcpFeedback('goog-remb', null);
    }
    if (codecConfig.tcc.enabled && options.tcc) {
        pt.addRtcpFeedback('transport-cc', null);
    }
}

// Video payload types
function createVideoPayloadTypes(options = new OfferOptions()) {
    const pts = [];
    if (codecConfig.av1.isEnabled()) {
        const av1 = createPayloadType({ id: codecConfig.av1.pt, name: 'AV1', clockrate: 90000 });
        addVideoExtensions(av1, options, codecConfig.av1);
        pts.push(av1);
    }
    if (codecConfig.vp8.isEnabled()) {
        const vp8 = createPayloadType({ id: codecConfig.vp8.pt, name: 'VP8', clockrate: 90000 });
        addVideoExtensions(vp8, options, codecConfig.vp8);
        pts.push(vp8);
    }
    if (codecConfig.h264.isEnabled()) {
        const h264 = createPayloadType({ id: codecConfig.h264.pt, name: 'H264', clockrate: 90000 });
        addVideoExtensions(h264, options, codecConfig.h264);
        h264.addParameter('profile-level-id', '42e01f;level-asymmetry-allowed=1;packetization-mode=1;');
        pts.push(h264);
    }
    if (codecConfig.vp9.isEnabled()) {
        const vp9 = createPayloadType({ id: codecConfig.vp9.pt, name: 'VP9', clockrate: 90000 });
        addVideoExtensions(vp9, options, codecConfig.vp9);
        pts.push(vp9);
    }
    if (options.rtx) {
        if (codecConfig.av1.isRtxEnabled()) {
            const rtx = createPayloadType({ id: codecConfig.av1.rtxPt, name: 'rtx', clockrate: 90000 });
            rtx.addParameter('apt', codecConfig.av1.pt.toString());
            rtx.addRtcpFeedback('ccm', 'fir');
            rtx.addRtcpFeedback('nack', null);
            rtx.addRtcpFeedback('nack', 'pli');
            pts.push(rtx);
        }
        if (codecConfig.vp8.isRtxEnabled()) {
            const rtx = createPayloadType({ id: codecConfig.vp8.rtxPt, name: 'rtx', clockrate: 90000 });
            rtx.addParameter('apt', codecConfig.vp8.pt.toString());
            rtx.addRtcpFeedback('ccm', 'fir');
            rtx.addRtcpFeedback('nack', null);
            rtx.addRtcpFeedback('nack', 'pli');
            pts.push(rtx);
        }
        if (codecConfig.vp9.isRtxEnabled()) {
            const rtx = createPayloadType({ id: codecConfig.vp9.rtxPt, name: 'rtx', clockrate: 90000 });
            rtx.addParameter('apt', codecConfig.vp9.pt.toString());
            rtx.addRtcpFeedback('ccm', 'fir');
            rtx.addRtcpFeedback('nack', null);
            rtx.addRtcpFeedback('nack', 'pli');
            pts.push(rtx);
        }
        if (codecConfig.h264.isRtxEnabled()) {
            const rtx = createPayloadType({ id: codecConfig.h264.rtxPt, name: 'rtx', clockrate: 90000 });
            rtx.addParameter('apt', codecConfig.h264.pt.toString());
            pts.push(rtx);
        }
    }
    return pts;
}

// Audio payload types
function createAudioPayloadTypes(options = new OfferOptions()) {
    const pts = [];
    if (codecConfig.opus.isEnabled()) {
        if (codecConfig.opus.red && codecConfig.opus.red.isEnabled() && options.opusRed) {
            const red = createPayloadType({ id: codecConfig.opus.red.pt, name: 'red', clockrate: 48000, channels: 2 });
            red.addParameter(null, codecConfig.opus.pt + '/' + codecConfig.opus.pt);
            pts.push(red);
        }
        const opus = createPayloadType({ id: codecConfig.opus.pt, name: 'opus', clockrate: 48000, channels: 2 });
        opus.addParameter('minptime', codecConfig.opus.minptime.toString());
        if (codecConfig.opus.useInbandFec && !(codecConfig.opus.red && codecConfig.opus.red.isEnabled())) {
            opus.addParameter('useinbandfec', '1');
        }
        if (codecConfig.tcc.enabled && options.tcc) {
            opus.addRtcpFeedback('transport-cc', null);
        }
        pts.push(opus);
    }
    if (codecConfig.telephoneEvent.isEnabled()) {
        pts.push(createPayloadType({ id: codecConfig.telephoneEvent.pt, name: 'telephone-event', clockrate: 8000 }));
    }
    return pts;
}

// RTP header extensions
function createAudioRtpHdrExts(options = new OfferOptions()) {
    const exts = [];
    if (codecConfig.audioLevel.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.audioLevel.id, uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' }));
    }
    if (codecConfig.mid.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.mid.id, uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' }));
    }
    if (codecConfig.tcc.enabled && options.tcc) {
        exts.push(new RTPHdrExt({ id: codecConfig.tcc.id, uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01' }));
    }
    return exts;
}

function createVideoRtpHdrExts(options = new OfferOptions()) {
    const exts = [];
    if (codecConfig.videoLayersAllocation.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.videoLayersAllocation.id, uri: 'http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00' }));
    }
    if (codecConfig.av1DependencyDescriptor.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.av1DependencyDescriptor.id, uri: 'https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension' }));
    }
    if (codecConfig.tof.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.tof.id, uri: 'urn:ietf:params:rtp-hdrext:toffset' }));
    }
    if (codecConfig.mid.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.mid.id, uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' }));
    }
    if (codecConfig.absSendTime.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.absSendTime.id, uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' }));
    }
    if (codecConfig.framemarking.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.framemarking.id, uri: 'http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07' }));
    }
    if (codecConfig.videoContentType.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.videoContentType.id, uri: 'http://www.webrtc.org/experiments/rtp-hdrext/video-content-type' }));
    }
    if (codecConfig.rid.enabled) {
        exts.push(new RTPHdrExt({ id: codecConfig.rid.id, uri: 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id' }));
    }
    if (codecConfig.tcc.enabled && options.tcc) {
        exts.push(new RTPHdrExt({ id: codecConfig.tcc.id, uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01' }));
    }
    return exts;
}

module.exports = {
    PayloadType,
    RTPHdrExt,
    createPayloadType,
    createVideoPayloadTypes,
    createAudioPayloadTypes,
    createAudioRtpHdrExts,
    createVideoRtpHdrExts,
    createRtcpFb,
    addVideoExtensions
}; 