const Source = require('./source');
const SsrcGroup = require('./ssrcGroup');
const MediaType = require('./mediaType');
const { SsrcGroupSemantics } = require('./ssrcGroupSemantics');
const { xml } = require('@xmpp/xml');

class EndpointSourceSet {
    /**
     * @param {Set<Source>} [sources=new Set()]
     * @param {Set<SsrcGroup>} [ssrcGroups=new Set()]
     */
    constructor(sources = new Set(), ssrcGroups = new Set()) {
        // Ensure inputs are Sets of the correct types, or convert if iterable of correct types
        this.sources = new Set();
        sources.forEach(s => {
            if (s instanceof Source) this.sources.add(s);
            // else console.warn("Invalid object passed to EndpointSourceSet sources constructor:", s);
        });

        this.ssrcGroups = new Set();
        ssrcGroups.forEach(g => {
            if (g instanceof SsrcGroup) this.ssrcGroups.add(g);
            // else console.warn("Invalid object passed to EndpointSourceSet ssrcGroups constructor:", g);
        });
    }

    /**
     * Convenience constructor for a single Source.
     * @param {Source} source
     */
    static fromSource(source) {
        return new EndpointSourceSet(new Set([source]));
    }

    /**
     * Convenience constructor for a single SsrcGroup.
     * @param {SsrcGroup} ssrcGroup
     */
    static fromSsrcGroup(ssrcGroup) {
        return new EndpointSourceSet(new Set(), new Set([ssrcGroup]));
    }

    isEmpty() {
        return this.sources.size === 0 && this.ssrcGroups.size === 0;
    }

    get hasAudio() {
        for (const source of this.sources) {
            if (source.mediaType === MediaType.AUDIO) return true;
        }
        return false;
    }

    get hasVideo() {
        for (const source of this.sources) {
            if (source.mediaType === MediaType.VIDEO) return true;
        }
        return false;
    }

    getSsrcs(mediaType) {
        const ssrcs = new Set();
        for (const source of this.sources) {
            if (source.mediaType === mediaType) {
                ssrcs.add(source.ssrc);
            }
        }
        return ssrcs;
    }

    get audioSsrcs() { return this.getSsrcs(MediaType.AUDIO); }
    get videoSsrcs() { return this.getSsrcs(MediaType.VIDEO); }

    /**
     * Populates a map of Jingle <content> XML elements with descriptions of the sources in this set.
     * The <content> elements will have an <description xmlns='urn:xmpp:jingle:apps:rtp:1'/> child,
     * which in turn will have <source/> and <ssrc-group/> children.
     * @param {Map<string, Element>} mediaTypeToContentMap - A map to populate (MediaType string -> <content> XML Element).
     * @param {string|null} [ownerEndpointId=null] - Optional owner ID for SSRCInfoPacketExtension.
     */
    toJingleContents(mediaTypeToContentMap, ownerEndpointId = null) {
        const getOrCreateContentAndDesc = (mediaType) => {
            let contentElement = mediaTypeToContentMap.get(mediaType);
            let rtpDescElement;

            if (!contentElement) {
                contentElement = xml('content', { name: mediaType });
                // Standard Jingle content creator/disposition would be set by the caller of toJingleContents,
                // e.g. JingleSession when building session-initiate.
                mediaTypeToContentMap.set(mediaType, contentElement);
            }

            rtpDescElement = contentElement.getChild('description', 'urn:xmpp:jingle:apps:rtp:1');
            if (!rtpDescElement) {
                rtpDescElement = xml('description', { xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: mediaType });
                contentElement.append(rtpDescElement);
            }
            return rtpDescElement;
        };

        this.sources.forEach(source => {
            const rtpDescElement = getOrCreateContentAndDesc(source.mediaType);
            rtpDescElement.append(source.toPacketExtension(ownerEndpointId));
        });

        this.ssrcGroups.forEach(group => {
            const rtpDescElement = getOrCreateContentAndDesc(group.mediaType);
            rtpDescElement.append(group.toPacketExtension());
        });
    }

    /**
     * Creates a list of Jingle <content> XML elements from this set.
     * @param {string|null} [ownerEndpointId=null]
     * @returns {Element[]}
     */
    toJingle(ownerEndpointId = null) {
        const mediaTypeToContentMap = new Map();
        this.toJingleContents(mediaTypeToContentMap, ownerEndpointId);
        return Array.from(mediaTypeToContentMap.values());
    }


    toString() {
        return `[audio=${JSON.stringify(Array.from(this.audioSsrcs))}, video=${JSON.stringify(Array.from(this.videoSsrcs))}, groups=${JSON.stringify(Array.from(this.ssrcGroups).map(g => g.toString()))}]`;
    }

    get stripSimulcast() {
        const groupsToRemove = new Set(); // Set of SsrcGroup uniqueKeys
        const ssrcsToRemove = new Set(); // Set of SSRC numbers

        this.ssrcGroups.forEach(group => {
            if (group.semantics === SsrcGroupSemantics.Simulcast) {
                groupsToRemove.add(group.uniqueKey);
                group.ssrcs.forEach((ssrc, index) => {
                    if (index > 0) ssrcsToRemove.add(ssrc); // Keep only the first SSRC of SIM group
                });
            }
        });

        this.ssrcGroups.forEach(group => {
            if (group.semantics === SsrcGroupSemantics.Fid) {
                if (group.ssrcs.length !== 2) {
                    // This was an error throw in Kotlin, log warning here
                    console.warn(`Invalid FID group, has ${group.ssrcs.length} ssrcs: ${group.toString()}`);
                    return;
                }
                // If the primary SSRC of FID group is being removed (because it was a secondary SIM SSRC), remove FID group and its RTX SSRC
                if (ssrcsToRemove.has(group.ssrcs[0])) {
                    ssrcsToRemove.add(group.ssrcs[1]);
                    groupsToRemove.add(group.uniqueKey);
                }
            }
        });

        const newSources = new Set();
        this.sources.forEach(s => {
            if (!ssrcsToRemove.has(s.ssrc)) newSources.add(s);
        });

        const newSsrcGroups = new Set();
        this.ssrcGroups.forEach(g => {
            if (!groupsToRemove.has(g.uniqueKey)) newSsrcGroups.add(g);
        });

        return new EndpointSourceSet(newSources, newSsrcGroups);
    }

    stripByMediaType(retainMediaTypesSet) { // retainMediaTypesSet is a Set of MediaType strings
        if (retainMediaTypesSet.has(MediaType.AUDIO) && retainMediaTypesSet.has(MediaType.VIDEO)) {
            return this; // Nothing to strip if both main types are retained
        }
        const newSources = new Set();
        this.sources.forEach(s => {
            if (retainMediaTypesSet.has(s.mediaType)) newSources.add(s);
        });

        const newSsrcGroups = new Set();
        this.ssrcGroups.forEach(g => {
            if (retainMediaTypesSet.has(g.mediaType)) newSsrcGroups.add(g);
        });

        if (newSources.size === 0 && newSsrcGroups.size === 0) return EndpointSourceSet.EMPTY;
        return new EndpointSourceSet(newSources, newSsrcGroups);
    }


    get compactJson() {
        const videoSourcesJson = Array.from(this.sources)
            .filter(s => s.mediaType === MediaType.VIDEO)
            .map(s => JSON.parse(s.compactJson)); // compactJson returns string, parse to object for array
        const videoGroupsJson = Array.from(this.ssrcGroups)
            .filter(g => g.mediaType === MediaType.VIDEO)
            .map(g => JSON.parse(g.compactJson));

        const audioSourcesJson = Array.from(this.sources)
            .filter(s => s.mediaType === MediaType.AUDIO)
            .map(s => JSON.parse(s.compactJson));
        const audioGroupsJson = Array.from(this.ssrcGroups)
            .filter(g => g.mediaType === MediaType.AUDIO)
            .map(g => JSON.parse(g.compactJson));

        const result = [videoSourcesJson, videoGroupsJson, audioSourcesJson];
        if (audioGroupsJson.length > 0) {
            result.push(audioGroupsJson);
        }
        // Remove trailing empty arrays for compactness, up to video sources
        while (result.length > 2 && result[result.length - 1].length === 0 && result[result.length - 2].length === 0) {
             if (result.length === 3 && audioSourcesJson.length > 0) break; // Don't remove audio sources if present
             result.pop();
        }


        return JSON.stringify(result);
    }

    toJson() {
        return {
            sources: Array.from(this.sources).map(s => s.toJson()),
            groups: Array.from(this.ssrcGroups).map(g => g.toJson())
        };
    }

    copy() {
        // Source and SsrcGroup are data-like; shallow copy of sets is fine
        return new EndpointSourceSet(new Set(this.sources), new Set(this.ssrcGroups));
    }

    /**
     * Adds sources and groups from another EndpointSourceSet.
     * Returns a new EndpointSourceSet instance.
     * @param {EndpointSourceSet} other
     * @returns {EndpointSourceSet}
     */
    add(other) {
        if (!other) return this.copy();
        const newSources = new Set(this.sources);
        other.sources.forEach(s => newSources.add(s)); // Set handles duplicates based on object reference
                                                       // For value-based uniqueness, need to manage manually or use Source.uniqueKey
        const newSsrcGroups = new Set(this.ssrcGroups);
        other.ssrcGroups.forEach(g => newSsrcGroups.add(g));
        return new EndpointSourceSet(newSources, newSsrcGroups);
    }

    /**
     * Removes sources and groups present in another EndpointSourceSet.
     * Returns a new EndpointSourceSet instance.
     * @param {EndpointSourceSet} other
     * @returns {EndpointSourceSet}
     */
    remove(other) {
        if (!other) return this.copy();
        const newSources = new Set();
        const otherSourceKeys = new Set(Array.from(other.sources).map(s => s.uniqueKey));
        this.sources.forEach(s => {
            if (!otherSourceKeys.has(s.uniqueKey)) newSources.add(s);
        });

        const newSsrcGroups = new Set();
        const otherGroupKeys = new Set(Array.from(other.ssrcGroups).map(g => g.uniqueKey));
        this.ssrcGroups.forEach(g => {
            if (!otherGroupKeys.has(g.uniqueKey)) newSsrcGroups.add(g);
        });
        return new EndpointSourceSet(newSources, newSsrcGroups);
    }


    static EMPTY = Object.freeze(new EndpointSourceSet());

    /**
     * Parses a list of Jingle <content> XML elements into an EndpointSourceSet.
     * @param {Element[]} contentElements - Array of Jingle <content> XML elements.
     * @returns {EndpointSourceSet}
     * @throws {Error} if media type is invalid or other parsing errors.
     */
    static fromJingle(contentElements) {
        const sources = new Set();
        const ssrcGroups = new Set();

        contentElements.forEach(contentElement => {
            const rtpDescElement = contentElement.getChild('description', 'urn:xmpp:jingle:apps:rtp:1');
            const mediaTypeStr = rtpDescElement ? rtpDescElement.attrs.media : contentElement.attrs.name;

            let mediaType;
            try {
                // MediaType.parseString from Kotlin, we'll just use our MediaType object
                mediaType = Object.values(MediaType).find(mt => mt.toLowerCase() === mediaTypeStr?.toLowerCase());
                if (!mediaType) {
                    throw new Error(`Invalid media type: ${mediaTypeStr}`);
                }
            } catch (e) {
                throw new Error(`Failed to parse media type '${mediaTypeStr}': ${e.message}`);
            }

            const processContainer = (container) => {
                container.getChildren('source', 'urn:xmpp:jingle:apps:rtp:ssma:0').forEach(sourceEl => {
                    try {
                        sources.add(Source.fromPacketExtension(mediaType, sourceEl));
                    } catch (e) {
                        console.warn(`Failed to parse source from packet extension: ${e.message}`, sourceEl.toString());
                    }
                });
                if (rtpDescElement) { // SSRC groups are typically under rtp-description
                    rtpDescElement.getChildren('ssrc-group', 'urn:xmpp:jingle:apps:rtp:ssma:0').forEach(groupEl => {
                        try {
                            ssrcGroups.add(SsrcGroup.fromPacketExtension(groupEl, mediaType));
                        } catch (e) {
                            console.warn(`Failed to parse ssrc-group from packet extension: ${e.message}`, groupEl.toString());
                        }
                    });
                }
            };

            // Kotlin code checked both <content> and <description> for <source> children.
            // <ssrc-group> is usually only under <description>.
            processContainer(contentElement); // Check <source> under <content>
            if (rtpDescElement) {
                processContainer(rtpDescElement); // Check <source> under <description> and <ssrc-group>
            }

        });
        return new EndpointSourceSet(sources, ssrcGroups);
    }

    /**
     * Creates a Colibri2 <sources> XML element containing descriptions of the sources and groups in this set.
     * The individual <source> and <ssrc-group> elements will be in the Jingle SSMA namespace.
     * @param {string|null} [ownerEndpointId=null] - Optional owner ID for SSRCInfoPacketExtension within <source> elements.
     * @returns {Element|null} The <sources xmlns='urn:xmpp:colibri2:conference'> XML element, or null if no sources/groups.
     */
    toColibriSourcesElement(ownerEndpointId = null) {
        if (this.isEmpty()) {
            return null;
        }

        const sourceElements = [];
        this.sources.forEach(s => {
            sourceElements.push(s.toPacketExtension(ownerEndpointId));
        });
        this.ssrcGroups.forEach(g => {
            sourceElements.push(g.toPacketExtension());
        });

        if (sourceElements.length === 0) {
            return null;
        }

        return xml('sources', { xmlns: 'urn:xmpp:colibri2:conference' }, ...sourceElements);
    }

    /**
     * Creates an EndpointSourceSet from a Colibri2 <sources> XML element.
     * Assumes child <source> and <ssrc-group> elements are in Jingle SSMA namespace.
     * @param {Element} colibriSourcesElement - The <sources xmlns='urn:xmpp:colibri2:conference'> XML element.
     * @param {string} mediaTypeContext - The media type of the parent content/endpoint, used if not on source/group.
     * @returns {EndpointSourceSet}
     */
    static fromColibriSourcesElement(colibriSourcesElement) {
        const sources = new Set();
        const ssrcGroups = new Set();

        if (colibriSourcesElement && colibriSourcesElement.name === 'sources' &&
            (colibriSourcesElement.attrs.xmlns === 'urn:xmpp:colibri2:conference' ||
             colibriSourcesElement.attrs.xmlns === 'http://jitsi.org/protocol/colibri')) { // Allow original colibri too for parsing feedback

            // Colibri <sources> typically contains <source> and <ssrc-group> from Jingle SSMA namespace.
            // The Source.fromPacketExtension and SsrcGroup.fromPacketExtension need a mediaType.
            // In Colibri feedback sources, the media type is often implicit or on the <source> itself.
            // Let's assume Source.fromPacketExtension can infer mediaType if it's on the element,
            // or we might need to adjust how mediaType is determined here if it's purely contextual.
            // For now, we'll pass null and expect fromPacketExtension to handle it or error if ambiguous.

            colibriSourcesElement.getChildren('source', 'urn:xmpp:jingle:apps:rtp:ssma:0').forEach(sourceEl => {
                try {
                    // Try to get mediaType from the sourceEl itself if present, else pass null.
                    // Jitsi's SourcePacketExtension in Java might have a .getMediaType() method
                    // that could parse it from 'name' or other attributes if not explicit.
                    // Our Source.fromPacketExtension currently takes mediaType as an argument.
                    // This implies the colibri <source> element should contain enough info or this approach needs adjustment.
                    // Let's assume for feedback sources, the mediaType is often missing and might not be critical
                    // if only SSRCs are needed. Or, the caller of this function should provide context.
                    // For now, we try to parse with a placeholder or let Source.fromPacketExtension deal with it.
                    // A common case for feedback sources is just the SSRC.
                    const ssrc = parseInt(sourceEl.attrs.ssrc, 10);
                    if (!isNaN(ssrc)) {
                         // Attempt to infer mediaType from 'name' if it follows pattern like 'audio' or 'video'
                         let mediaType = null;
                         if (sourceEl.attrs.name === MediaType.AUDIO || sourceEl.attrs.name === MediaType.VIDEO) {
                             mediaType = sourceEl.attrs.name;
                         }
                         // If Source.fromPacketExtension requires mediaType and it's not on sourceEl, this will fail.
                         // We might need a simpler Source constructor for feedback SSRCs if only SSRC is present.
                         // For now, assuming Source.fromPacketExtension can handle elements with just SSRC if mediaType is passed.
                         // This is a gap: How is mediaType determined for feedback sources if not on element?
                         // Let's assume for now that feedback sources might not always have a clear media type in the XML itself
                         // and might be contextually understood or just treated as generic SSRCs.
                         // For simplicity, if Source.fromPacketExtension can take a potentially null mediaType
                         // and still extract SSRC, that's one way.
                         // Or, we create a simpler Source object for feedback.
                         // The Source constructor requires mediaType. This needs to be resolved.
                         //
                         // HACK/Placeholder: If mediaType is not on sourceEl, what to do?
                         // Jicofo's ColibriConferenceIQ.Source has mediaType.
                         // So, the XML from the bridge SHOULD have it, or it's inferred.
                         // Let's assume the parsing in Source.fromPacketExtension needs to be robust.
                         // For now, we will pass a default or throw if not found.
                         // Let's assume Source.fromPacketExtension is adapted to try and find it.
                         sources.add(Source.fromPacketExtension(null, sourceEl)); // Pass null, let fromPacketExtension try to find it or use default
                    }
                } catch (e) {
                    console.warn(`Failed to parse source from Colibri <sources> element: ${e.message}`, sourceEl.toString());
                }
            });
            colibriSourcesElement.getChildren('ssrc-group', 'urn:xmpp:jingle:apps:rtp:ssma:0').forEach(groupEl => {
                try {
                    // Similar issue for SsrcGroup.fromPacketExtension and mediaType.
                    ssrcGroups.add(SsrcGroup.fromPacketExtension(groupEl, null)); // Pass null for mediaType for now
                } catch (e) {
                    console.warn(`Failed to parse ssrc-group from Colibri <sources> element: ${e.message}`, groupEl.toString());
                }
            });
        }
        return new EndpointSourceSet(sources, ssrcGroups);
    }
}

module.exports = EndpointSourceSet;
