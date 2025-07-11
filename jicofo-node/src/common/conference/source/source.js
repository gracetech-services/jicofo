const MediaType = require('./mediaType');
const { VideoType, parseVideoType } = require('./videoType');
const { xml } = require('@xmpp/xml');
const { JidUtils } = require('../../config/serviceConfigs'); // For JidCreate.from equivalent if owner is JID like

/**
 * Represents a single media source (SSRC).
 */
class Source {
    /**
     * @param {number} ssrc - The SSRC ID.
     * @param {string} mediaType - MediaType string (e.g., MediaType.AUDIO, MediaType.VIDEO).
     * @param {string|null} [name=null] - Optional source name (e.g., mslabel).
     * @param {string|null} [msid=null] - Optional MediaStream ID (msid).
     * @param {string|null} [videoType=null] - Optional VideoType string (e.g., VideoType.CAMERA).
     */
    constructor(ssrc, mediaType, name = null, msid = null, videoType = null) {
        if (typeof ssrc !== 'number' || ssrc <= 0) {
            throw new Error('SSRC must be a positive number.');
        }
        // Ensure mediaType is a valid value from our MediaType object
        if (!Object.values(MediaType).includes(mediaType)) {
            // Keep it flexible for now, or throw error for strictness:
            // throw new Error(`Invalid mediaType: ${mediaType}`);
        }
        this.ssrc = ssrc;
        this.mediaType = mediaType;
        this.name = name;
        this.msid = msid;
        this.videoType = videoType ? parseVideoType(videoType) : VideoType.NONE;
    }

    /**
     * Creates a Source instance from an XMPP <source> XML element.
     * @param {string} mediaType - The media type for these sources (audio or video).
     * @param {Element} sourceElement - The <source xmlns='urn:xmpp:jingle:apps:rtp:ssma:0'> XML element.
     * @returns {Source} A new Source instance.
     */
    static fromPacketExtension(mediaTypeContext, sourceElement) {
        const ssrc = parseInt(sourceElement.attrs.ssrc, 10);
        if (isNaN(ssrc)) {
            throw new Error('Invalid SSRC in source packet extension');
        }

        let resolvedMediaType = mediaTypeContext;
        if (!resolvedMediaType && sourceElement.attrs.media) {
            const mt = sourceElement.attrs.media.toUpperCase();
            if (MediaType[mt]) {
                resolvedMediaType = MediaType[mt];
            }
        }
        if (!resolvedMediaType) {
            // Fallback or throw if mediaType is essential and cannot be determined
            // For feedback sources, sometimes only SSRC is present and type is implicit.
            // However, our Source object requires it.
            // This indicates a potential design mismatch or need for more context.
            // For now, defaulting to VIDEO for feedback sources if ambiguous, as they are often just SSRCs.
            // This is a HACK. A better solution is needed based on actual Colibri response structure.
            // console.warn(`MediaType for SSRC ${ssrc} is ambiguous, defaulting to VIDEO. Element: ${sourceElement.toString()}`);
            // resolvedMediaType = MediaType.VIDEO;
            // Let's make it stricter: if no mediaType, we can't form a valid Source object as per current constructor.
             throw new Error(`Cannot determine mediaType for SSRC ${ssrc} from source element: ${sourceElement.toString()}`);
        }


        let name = sourceElement.attrs.name;
        let msid = null;
        let videoTypeStr = sourceElement.attrs.videoType || null;

        const parameters = sourceElement.getChildren('parameter', 'urn:xmpp:jingle:apps:rtp:ssma:0');
        parameters.forEach(param => {
            if (param.attrs.name === 'msid') {
                msid = param.attrs.value;
            }
        });

        return new Source(ssrc, resolvedMediaType, name, msid, videoTypeStr);
    }

    /**
     * Converts this Source object to an XMPP <source> XML element.
     * @param {string|null} [ownerJidStr=null] - Optional JID string of the owner for SSRCInfo.
     * @param {boolean} [encodeMsid=true] - Whether to include the msid parameter.
     * @returns {Element} The <source> XML element.
     */
    toPacketExtension(ownerJidStr = null, encodeMsid = true) {
        const sourceAttrs = {
            xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0', // Jingle SSRC Media Attributes
            ssrc: this.ssrc.toString()
        };
        if (this.name) { // Jitsi's SourcePacketExtension has a 'name' field
            sourceAttrs.name = this.name;
        }
        // Jitsi's SourcePacketExtension also has a 'videoType' field.
        if (this.mediaType === MediaType.VIDEO && this.videoType && this.videoType !== VideoType.NONE) {
            sourceAttrs.videoType = this.videoType;
        }

        const children = [];
        if (ownerJidStr) {
            // JidUtils.parse(ownerJidStr) might be needed if owner is full JID and only bare/full is desired
            children.push(
                xml('ssrc-info', { xmlns: 'http://jitsi.org/jitmeet', owner: ownerJidStr })
            );
        }
        if (encodeMsid && this.msid) {
            children.push(
                xml('parameter', { xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0', name: 'msid', value: this.msid })
            );
        }

        return xml('source', sourceAttrs, ...children);
    }

    /**
     * Gets a compact JSON representation of this Source.
     * @returns {string}
     */
    get compactJson() {
        const parts = [`"s":${this.ssrc}`];
        if (this.name) {
            parts.push(`"n":"${this.name}"`);
        }
        if (this.msid) {
            parts.push(`"m":"${this.msid}"`);
        }
        if (this.mediaType === MediaType.VIDEO && this.videoType === VideoType.DESKTOP) {
            parts.push(`"v":"d"`);
        } else if (this.mediaType === MediaType.VIDEO && this.videoType === VideoType.CAMERA) {
            // Kotlin version only explicitly adds for Desktop. If Camera also needs a flag:
            // parts.push(`"v":"c"`);
        }
        return `{${parts.join(',')}}`;
    }

    /**
     * Gets an expanded JSON object for debugging.
     * @returns {object}
     */
    toJson() {
        return {
            ssrc: this.ssrc,
            media_type: this.mediaType,
            name: this.name || null, // Explicitly null if not present
            msid: this.msid || null,
            videoType: this.videoType // Already parsed to VideoType string or VideoType.NONE
        };
    }

    /**
     * Generates a source name in a deterministic format.
     * @param {string} endpointId
     * @param {string} mediaType - MediaType string
     * @param {number} idx - Zero-based index of the source.
     * @returns {string}
     */
    static nameForIdAndMediaType(endpointId, mediaType, idx) {
        if (!endpointId || !mediaType || typeof idx !== 'number') {
            throw new Error('endpointId, mediaType, and idx are required for nameForIdAndMediaType');
        }
        return `${endpointId}-${mediaType.charAt(0)}${idx}`;
    }

    /**
     * Checks for equality (same SSRC and mediaType).
     * Other fields (name, msid, videoType) are attributes of the SSRC, not part of its core identity.
     * @param {Source} other
     * @returns {boolean}
     */
    equals(other) {
        if (!(other instanceof Source)) {
            return false;
        }
        return this.ssrc === other.ssrc && this.mediaType === other.mediaType;
    }

    /**
     * Provides a unique key for this source, useful for Set operations.
     * @returns {string}
     */
    get uniqueKey() {
        return `${this.mediaType}_${this.ssrc}`;
    }
}

module.exports = Source;
