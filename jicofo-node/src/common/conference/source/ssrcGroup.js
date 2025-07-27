const MediaType = require('./mediaType');
const { SsrcGroupSemantics, parseSsrcGroupSemantics } = require('./ssrcGroupSemantics');
const { xml } = require('@xmpp/xml');

/**
 * Represents an SSRC grouping (e.g., an ssrc-group line in SDP).
 */
class SsrcGroup {
    /**
     * @param {string} semantics - The semantics of the group (e.g., SsrcGroupSemantics.Simulcast).
     * @param {number[]} ssrcs - An array of SSRC numbers in this group.
     * @param {string} [mediaType=MediaType.VIDEO] - The media type this group applies to.
     */
    constructor(semantics, ssrcs, mediaType = MediaType.VIDEO) {
        if (!Object.values(SsrcGroupSemantics).includes(semantics)) {
            // console.warn(`SsrcGroup: Unknown semantics '${semantics}', defaulting to UNKNOWN.`);
            // this.semantics = SsrcGroupSemantics.Unknown; // Or throw error
            throw new Error(`Invalid SSRC group semantics: ${semantics}`);
        }
        if (!Array.isArray(ssrcs) || ssrcs.some(isNaN)) {
            throw new Error('SSRCs must be an array of numbers.');
        }

        this.semantics = semantics;
        this.ssrcs = [...ssrcs].sort((a, b) => a - b); // Store sorted for consistent equality/key
        this.mediaType = mediaType;
    }

    /**
     * Creates an SsrcGroup instance from an XMPP <ssrc-group> XML element.
     * @param {Element} ssrcGroupElement - The <ssrc-group xmlns='urn:xmpp:jingle:apps:rtp:ssma:0'> XML element.
     * @param {string} [mediaType=MediaType.VIDEO] - The media type context.
     * @returns {SsrcGroup} A new SsrcGroup instance.
     * @throws {Error} if semantics is missing or invalid, or if mediaType cannot be determined.
     */
    static fromPacketExtension(ssrcGroupElement, mediaTypeContext = MediaType.VIDEO) {
        const semanticsStr = ssrcGroupElement.attrs.semantics?.toUpperCase();
        if (!semanticsStr) {
            throw new Error('Missing semantics in ssrc-group packet extension');
        }
        // parseSsrcGroupSemantics will return the input string if not found in our enum,
        // and the SsrcGroup constructor will then throw if it's not a valid known semantic.
        const semantics = parseSsrcGroupSemantics(semanticsStr);

        let resolvedMediaType = mediaTypeContext;
        // SsrcGroup elements in Jingle don't typically have a 'media' attribute themselves,
        // they inherit from the parent <description>. So mediaTypeContext is important.
        if (!resolvedMediaType) {
            // This implies an issue with how context is passed or if the XML is unexpected.
            throw new Error(`Cannot determine mediaType for SSRC group: ${ssrcGroupElement.toString()}`);
        }


        const ssrcs = ssrcGroupElement.getChildren('source', 'urn:xmpp:jingle:apps:rtp:ssma:0')
            .map(sourceEl => parseInt(sourceEl.attrs.ssrc, 10))
            .filter(ssrc => !isNaN(ssrc));

        return new SsrcGroup(semantics, ssrcs, resolvedMediaType);
    }

    /**
     * Converts this SsrcGroup object to an XMPP <ssrc-group> XML element.
     * @returns {Element} The <ssrc-group> XML element.
     */
    toPacketExtension() {
        const sourceElements = this.ssrcs.map(ssrc =>
            xml('source', { xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0', ssrc: ssrc.toString() })
        );

        return xml('ssrc-group', {
            xmlns: 'urn:xmpp:jingle:apps:rtp:ssma:0',
            semantics: this.semantics.toUpperCase() // Store and send as uppercase string
        }, ...sourceElements);
    }

    /**
     * Gets a compact JSON representation of this SsrcGroup.
     * E.g., ["s", 1, 2, 3] for Simulcast.
     * @returns {string}
     */
    get compactJson() {
        let semChar;
        switch (this.semantics) {
            case SsrcGroupSemantics.Simulcast: semChar = 's'; break;
            case SsrcGroupSemantics.Fid: semChar = 'f'; break;
            default: semChar = this.semantics; // Use full semantics if not SIM or FID
        }
        return JSON.stringify([semChar, ...this.ssrcs]);
    }

    /**
     * Gets an expanded JSON object for debugging.
     * @returns {object}
     */
    toJson() {
        return {
            semantics: this.semantics,
            media_type: this.mediaType,
            ssrcs: [...this.ssrcs] // Return a copy
        };
    }

    toString() {
        return `${this.semantics.toUpperCase()}[${this.ssrcs.join(',')}]`;
    }

    /**
     * Checks for equality with another SsrcGroup.
     * @param {SsrcGroup} other
     * @returns {boolean}
     */
    equals(other) {
        if (!(other instanceof SsrcGroup)) {
            return false;
        }
        return this.semantics === other.semantics &&
               this.mediaType === other.mediaType &&
               this.ssrcs.length === other.ssrcs.length &&
               this.ssrcs.every((ssrc, i) => ssrc === other.ssrcs[i]); // Assumes SSRCs are sorted
    }

    /**
     * Provides a unique key for this SsrcGroup, useful for Set operations.
     * SSRCs are sorted in constructor for consistent key.
     * @returns {string}
     */
    get uniqueKey() {
        return `${this.mediaType}_${this.semantics}_${this.ssrcs.join('-')}`;
    }
}

module.exports = SsrcGroup;
