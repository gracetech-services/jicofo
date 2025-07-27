const logger = require('../utils/logger');

/**
 * Represent a Jingle offer consisting of a set of "content" extensions (which internally contain RTP payload
 * information, transport information, etc) and a set of "sources".
 */
class Offer {
    /**
     * @param {Object} sources - The ConferenceSourceMap
     * @param {Array} contents - List of ContentPacketExtension objects
     */
    constructor(sources, contents) {
        this.sources = sources;
        this.contents = contents || [];
    }

    /**
     * Get the sources
     * @returns {Object} - The sources
     */
    getSources() {
        return this.sources;
    }

    /**
     * Get the contents
     * @returns {Array} - The contents
     */
    getContents() {
        return this.contents;
    }

    /**
     * Check if the offer has sources
     * @returns {boolean} - True if the offer has sources
     */
    hasSources() {
        return this.sources && Object.keys(this.sources).length > 0;
    }

    /**
     * Check if the offer has contents
     * @returns {boolean} - True if the offer has contents
     */
    hasContents() {
        return this.contents && this.contents.length > 0;
    }

    /**
     * Get the number of sources
     * @returns {number} - The number of sources
     */
    getSourceCount() {
        if (!this.sources) return 0;
        return Object.keys(this.sources).length;
    }

    /**
     * Get the number of contents
     * @returns {number} - The number of contents
     */
    getContentCount() {
        return this.contents ? this.contents.length : 0;
    }

    /**
     * Check if the offer is empty
     * @returns {boolean} - True if the offer is empty
     */
    isEmpty() {
        return !this.hasSources() && !this.hasContents();
    }

    /**
     * Convert to JSON
     * @returns {Object} - JSON representation
     */
    toJson() {
        return {
            sources: this.sources,
            contents: this.contents,
            sourceCount: this.getSourceCount(),
            contentCount: this.getContentCount(),
            hasSources: this.hasSources(),
            hasContents: this.hasContents(),
            isEmpty: this.isEmpty()
        };
    }

    /**
     * Create an empty offer
     * @returns {Offer} - An empty offer
     */
    static createEmpty() {
        return new Offer({}, []);
    }

    /**
     * Create an offer with only sources
     * @param {Object} sources - The sources
     * @returns {Offer} - An offer with only sources
     */
    static createWithSources(sources) {
        return new Offer(sources, []);
    }

    /**
     * Create an offer with only contents
     * @param {Array} contents - The contents
     * @returns {Offer} - An offer with only contents
     */
    static createWithContents(contents) {
        return new Offer({}, contents);
    }
}

module.exports = Offer; 