// codecUtil.test.js
const { expect } = require('chai');
const { codecConfig, CodecConfig, RtpExtensionConfig } = require('../lib/codecConfig');
const OfferOptions = require('../lib/offerOptions');
const codecUtil = require('../lib/codecUtil');

describe('Codec Utilities', () => {
    describe('OfferOptions', () => {
        it('should have correct defaults', () => {
            const opts = new OfferOptions();
            expect(opts.audio).to.be.true;
            expect(opts.video).to.be.true;
            expect(opts.sctp).to.be.true;
            expect(opts.tcc).to.be.true;
            expect(opts.remb).to.be.false;
            expect(opts.rtx).to.be.true;
            expect(opts.opusRed).to.be.true;
        });
        it('should allow overriding options', () => {
            const opts = new OfferOptions({ audio: false, remb: true });
            expect(opts.audio).to.be.false;
            expect(opts.remb).to.be.true;
        });
    });

    describe('CodecConfig', () => {
        it('should enable/disable codecs based on pt', () => {
            const c = new CodecConfig({ enabled: true, pt: 111 });
            expect(c.isEnabled()).to.be.true;
            c.pt = 0;
            expect(c.isEnabled()).to.be.false;
        });
        it('should enable RTX only if rtxPt > 0', () => {
            const c = new CodecConfig({ enabled: true, pt: 100, rtxPt: 96 });
            expect(c.isRtxEnabled()).to.be.true;
            c.rtxPt = 0;
            expect(c.isRtxEnabled()).to.be.false;
        });
    });

    describe('PayloadType and helpers', () => {
        it('should create video payload types with correct feedback', () => {
            const opts = new OfferOptions();
            const pts = codecUtil.createVideoPayloadTypes(opts);
            expect(pts).to.be.an('array').that.is.not.empty;
            const vp8 = pts.find(pt => pt.name === 'VP8');
            expect(vp8).to.exist;
            expect(vp8.rtcpFeedback).to.deep.include({ type: 'ccm', subtype: 'fir' });
            expect(vp8.rtcpFeedback).to.deep.include({ type: 'nack', subtype: null });
            expect(vp8.rtcpFeedback).to.deep.include({ type: 'nack', subtype: 'pli' });
        });
        it('should create audio payload types with correct parameters', () => {
            const opts = new OfferOptions();
            const pts = codecUtil.createAudioPayloadTypes(opts);
            const opus = pts.find(pt => pt.name === 'opus');
            expect(opus).to.exist;
            expect(opus.parameters).to.deep.include({ name: 'minptime', value: codecConfig.opus.minptime.toString() });
        });
        it('should add RED before opus if enabled', () => {
            const opts = new OfferOptions({ opusRed: true });
            const pts = codecUtil.createAudioPayloadTypes(opts);
            const redIdx = pts.findIndex(pt => pt.name === 'red');
            const opusIdx = pts.findIndex(pt => pt.name === 'opus');
            expect(redIdx).to.be.lessThan(opusIdx);
        });
    });

    describe('RTP Header Extensions', () => {
        it('should create audio RTP header extensions', () => {
            const opts = new OfferOptions();
            const exts = codecUtil.createAudioRtpHdrExts(opts);
            expect(exts).to.be.an('array').that.is.not.empty;
            expect(exts.map(e => e.uri)).to.include('urn:ietf:params:rtp-hdrext:ssrc-audio-level');
        });
        it('should create video RTP header extensions', () => {
            const opts = new OfferOptions();
            const exts = codecUtil.createVideoRtpHdrExts(opts);
            expect(exts).to.be.an('array').that.is.not.empty;
            expect(exts.map(e => e.uri)).to.include('http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00');
        });
    });

    describe('Config toggling', () => {
        it('should disable codecs if config is toggled', () => {
            const oldEnabled = codecConfig.vp8.enabled;
            codecConfig.vp8.enabled = false;
            const pts = codecUtil.createVideoPayloadTypes();
            expect(pts.find(pt => pt.name === 'VP8')).to.not.exist;
            codecConfig.vp8.enabled = oldEnabled; // restore
        });
    });
}); 