const { xml } = require('@xmpp/xml'); // For potential future toXmlElement method

const JINGLE_ICE_UDP_TRANSPORT_NS = 'urn:xmpp:jingle:transports:ice-udp:1';
const JINGLE_DTLS_SRTP_NS = 'urn:xmpp:jingle:apps:rtp:dtls:0'; // Or :1

class IceUdpTransportCandidate {
    /**
     * @param {object} attrs - Attributes of the <candidate> element.
     */
    constructor(attrs) {
        this.foundation = attrs.foundation;
        this.component = parseInt(attrs.component, 10);
        this.protocol = attrs.protocol; // 'udp' or 'tcp'
        this.priority = parseInt(attrs.priority, 10);
        this.ip = attrs.ip;
        this.port = parseInt(attrs.port, 10);
        this.type = attrs.type; // 'host', 'srflx', 'prflx', 'relay'
        this.relAddr = attrs['rel-addr'] || null;
        this.relPort = attrs['rel-port'] ? parseInt(attrs['rel-port'], 10) : null;
        this.generation = attrs.generation ? parseInt(attrs.generation, 10) : 0;
        this.id = attrs.id;
        // TODO: Add other potential attributes like network, tcptype
    }

    toXml() {
        const attrs = {
            foundation: this.foundation,
            component: this.component,
            protocol: this.protocol,
            priority: this.priority,
            ip: this.ip,
            port: this.port,
            type: this.type,
            id: this.id,
            generation: this.generation
        };
        if (this.relAddr) attrs['rel-addr'] = this.relAddr;
        if (this.relPort) attrs['rel-port'] = this.relPort;
        return xml('candidate', attrs);
    }
}

class DtlsFingerprint {
    /**
     * @param {object} attrs - Attributes of the <fingerprint> element.
     * @param {string} value - The fingerprint value.
     */
    constructor(attrs, value) {
        this.hash = attrs.hash; // e.g., 'sha-256'
        this.setup = attrs.setup; // e.g., 'active', 'passive', 'actpass'
        this.value = value;
        // TODO: Add other attributes like 'required' if needed
    }

    toXml() {
        return xml('fingerprint', { xmlns: JINGLE_DTLS_SRTP_NS, hash: this.hash, setup: this.setup }, this.value);
    }
}

class IceUdpTransport {
    /**
     * @param {string|null} ufrag - ICE ufrag.
     * @param {string|null} pwd - ICE password.
     * @param {boolean} rtcpMux - Whether RTCP muxing is used.
     * @param {IceUdpTransportCandidate[]} candidates - Array of candidates.
     * @param {DtlsFingerprint[]} fingerprints - Array of DTLS fingerprints.
     */
    constructor(ufrag, pwd, rtcpMux = true, candidates = [], fingerprints = []) {
        this.ufrag = ufrag;
        this.pwd = pwd;
        this.rtcpMux = rtcpMux;
        this.candidates = candidates; // Array of IceUdpTransportCandidate instances
        this.fingerprints = fingerprints; // Array of DtlsFingerprint instances
    }

    /**
     * Creates an IceUdpTransport instance from an XMPP <transport> XML element.
     * @param {Element} transportElement - The <transport xmlns='urn:xmpp:jingle:transports:ice-udp:1'> XML element.
     * @returns {IceUdpTransport|null} A new IceUdpTransport instance or null if input is invalid.
     */
    static fromXmlElement(transportElement) {
        if (!transportElement || transportElement.name !== 'transport' || transportElement.attrs.xmlns !== JINGLE_ICE_UDP_TRANSPORT_NS) {
            // console.warn('Invalid XML element passed to IceUdpTransport.fromXmlElement');
            return null;
        }

        const ufrag = transportElement.attrs.ufrag || null;
        const pwd = transportElement.attrs.pwd || null;
        const rtcpMux = transportElement.getChild('rtcp-mux') ? true : false;

        const candidates = transportElement.getChildren('candidate').map(cEl => new IceUdpTransportCandidate(cEl.attrs));

        const fingerprints = transportElement.getChildren('fingerprint', JINGLE_DTLS_SRTP_NS)
            .map(fEl => new DtlsFingerprint(fEl.attrs, fEl.getText()));

        return new IceUdpTransport(ufrag, pwd, rtcpMux, candidates, fingerprints);
    }

    /**
     * Converts this IceUdpTransport object to an XMPP <transport> XML element.
     * @returns {Element} The <transport> XML element.
     */
    toXmlElement() {
        const transportAttrs = { xmlns: JINGLE_ICE_UDP_TRANSPORT_NS };
        if (this.ufrag) transportAttrs.ufrag = this.ufrag;
        if (this.pwd) transportAttrs.pwd = this.pwd;

        const children = [];
        if (this.rtcpMux) {
            children.push(xml('rtcp-mux'));
        }
        this.fingerprints.forEach(fp => children.push(fp.toXml()));
        this.candidates.forEach(cand => children.push(cand.toXml()));

        return xml('transport', transportAttrs, ...children);
    }
}

module.exports = {
    IceUdpTransport,
    IceUdpTransportCandidate,
    DtlsFingerprint,
    JINGLE_ICE_UDP_TRANSPORT_NS,
    JINGLE_DTLS_SRTP_NS
};
