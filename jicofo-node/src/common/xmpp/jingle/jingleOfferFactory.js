const { createElement } = require('@xmpp/xml');
const path = require('path');
const projectRoot = path.resolve(__dirname, '../../../../');
const codecUtil = require(projectRoot + '/lib/codecUtil');
const OfferOptions = require(projectRoot + '/lib/offerOptions');
const { codecConfig } = require(projectRoot + '/lib/codecConfig');

/**
 * Creates a Jingle offer (array of <content> elements) for the given options and config.
 * @param {Object} params
 *   - audio: boolean (default true)
 *   - video: boolean (default true)
 *   - sctp: boolean (default true)
 *   - options: object (per-offer customization)
 *   - config: object (global config, can be omitted to use built-in codecConfig)
 * @returns {Element[]} Array of <content> XML elements.
 */
function createJingleOffer({ audio = true, video = true, sctp = true, options = {}, config } = {}) {
  const contents = [];
  if (audio) contents.push(createMediaContent('audio', config, options));
  if (video) contents.push(createMediaContent('video', config, options));
  if (sctp) contents.push(createDataContent(config, options));
  return contents.filter(Boolean);
}

function createMediaContent(mediaType, config, options) {
  const content = createElement('content', { creator: 'initiator', name: mediaType, senders: 'both' });
  const rtpDescription = createElement('description', { xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: mediaType });

  // Use new codec utilities for payload types and RTP header extensions
  const offerOpts = new OfferOptions(options);
  let payloadTypes = [];
  let rtpHdrExts = [];
  if (mediaType === 'audio') {
    payloadTypes = codecUtil.createAudioPayloadTypes(offerOpts);
    rtpHdrExts = codecUtil.createAudioRtpHdrExts(offerOpts);
  } else if (mediaType === 'video') {
    payloadTypes = codecUtil.createVideoPayloadTypes(offerOpts);
    rtpHdrExts = codecUtil.createVideoRtpHdrExts(offerOpts);
  }
  // Convert payloadTypes and rtpHdrExts to XML elements
  payloadTypes.forEach(pt => {
    const attrs = {
      id: pt.id.toString(),
      name: pt.name,
      clockrate: pt.clockrate.toString()
    };
    if (pt.channels) attrs.channels = pt.channels.toString();
    const paramElements = (pt.parameters || []).map(p => createElement('parameter', { name: p.name, value: p.value }));
    const feedbackElements = (pt.rtcpFeedback || []).map(fb => {
      const fbAttrs = { type: fb.type };
      if (fb.subtype) fbAttrs.subtype = fb.subtype;
      return createElement('rtcp-fb', fbAttrs);
    });
    rtpDescription.append(createElement('payload-type', attrs, ...paramElements, ...feedbackElements));
  });
  rtpHdrExts.forEach(ext => {
    rtpDescription.append(
      createElement('rtp-hdrext', {
        xmlns: 'urn:xmpp:jingle:apps:rtp:rtp-hdrext:0',
        id: ext.id.toString(),
        uri: ext.uri
      })
    );
  });

  content.append(rtpDescription);
  // TODO: Add transport, etc. as needed
  return content;
}

function createDataContent(config, options) {
  // SCTP data channel offer
  const content = createElement('content', { creator: 'initiator', name: 'data', senders: 'both' });
  const dataApplicationDesc = createElement('description', { xmlns: 'urn:xmpp:jingle:apps:webrtc-datachannel:0' });
  content.append(dataApplicationDesc);
  // TODO: Add transport if needed
  return content;
}

module.exports = { createJingleOffer }; 