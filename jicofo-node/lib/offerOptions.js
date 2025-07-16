// offerOptions.js
// Options for an offer that jicofo generates for a specific participant, ported from OfferOptions.kt

class OfferOptions {
    constructor({ audio = true, video = true, sctp = true, tcc = true, remb = false, rtx = true, opusRed = true } = {}) {
        this.audio = audio;
        this.video = video;
        this.sctp = sctp;
        this.tcc = tcc;
        this.remb = remb;
        this.rtx = rtx;
        this.opusRed = opusRed;
    }
}

module.exports = OfferOptions; 