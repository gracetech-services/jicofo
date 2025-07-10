const EndpointSourceSet = require('./endpointSourceSet'); // Use the actual class
// const Source = require('./source'); // No longer needed directly here
// const SsrcGroup = require('./ssrcGroup'); // No longer needed directly here
const MediaType = require('./mediaType');
const { xml } = require('@xmpp/xml'); // For toJingle() later

class ConferenceSourceMap {
    /**
     * @param {Map<string, EndpointSourceSet> | Record<string, EndpointSourceSet> | Array<[string, EndpointSourceSet]> | null} [initialData=null]
     *        Initial data for the map. Can be a Map, an object, or an array of [owner, EndpointSourceSet] pairs.
     */
    constructor(initialData) {
        /** @private @type {Map<string, EndpointSourceSet>} */
        this.endpointSourceSets = new Map();

        if (initialData) {
            if (initialData instanceof Map) {
                initialData.forEach((value, key) => {
                    if (!(value instanceof EndpointSourceSet)) throw new Error('Initial data values must be EndpointSourceSet instances if using a Map');
                    this.endpointSourceSets.set(key, value);
                });
            } else if (Array.isArray(initialData)) { // Array of [owner, EndpointSourceSet instance] pairs
                initialData.forEach(([key, value]) => {
                    if (!(value instanceof EndpointSourceSet)) throw new Error('Initial data values must be EndpointSourceSet instances if using an Array of pairs');
                    this.endpointSourceSets.set(key, value);
                });
            } else if (typeof initialData === 'object' && initialData !== null) { // Plain object { owner: EndpointSourceSet instance }
                for (const key in initialData) {
                    if (Object.hasOwnProperty.call(initialData, key)) {
                        const value = initialData[key];
                        if (!(value instanceof EndpointSourceSet)) throw new Error('Initial data values must be EndpointSourceSet instances if using an object');
                        this.endpointSourceSets.set(key, value);
                    }
                }
            } else if (initialData instanceof ConferenceSourceMap) { // Copy constructor like
                 initialData.forEach((value, key) => {
                    this.endpointSourceSets.set(key, value.copy()); // Ensure deep copy of sets
                });
            }
        }
    }

    /**
     * Creates a ConferenceSourceMap from an owner and an EndpointSourceSet.
     * @param {string} owner
     * @param {EndpointSourceSet} endpointSourceSet
     * @returns {ConferenceSourceMap}
     */
    static fromOwnerAndSet(owner, endpointSourceSet) {
        const map = new ConferenceSourceMap();
        map.add(owner, endpointSourceSet);
        return map;
    }

    /**
     * Creates a ConferenceSourceMap from an owner and Jingle contents.
     * @param {string} owner
     * @param {Element[]} contents - Array of Jingle <content> XML elements.
     * @returns {ConferenceSourceMap}
     */
    static fromJingleContents(owner, contents) {
        return ConferenceSourceMap.fromOwnerAndSet(owner, EndpointSourceSet.fromJingle(contents));
    }


    get(owner) {
        return this.endpointSourceSets.get(owner);
    }

    has(owner) {
        return this.endpointSourceSets.has(owner);
    }

    set(owner, endpointSourceSet) {
        if (!(endpointSourceSet instanceof EndpointSourceSet)) {
            throw new Error('Value must be an instance of EndpointSourceSet');
        }
        this.endpointSourceSets.set(owner, endpointSourceSet);
    }

    /**
     * Adds sources. If ownerOrOther is a string, adds/merges endpointSourceSet for that owner.
     * If ownerOrOther is another ConferenceSourceMap, merges all its entries.
     * @param {string | ConferenceSourceMap} ownerOrOther
     * @param {EndpointSourceSet} [endpointSourceSet] - Required if ownerOrOther is a string.
     */
    add(ownerOrOther, endpointSourceSet) {
        if (typeof ownerOrOther === 'string') {
            const owner = ownerOrOther;
            if (!(endpointSourceSet instanceof EndpointSourceSet)) {
                throw new Error('endpointSourceSet must be an instance of EndpointSourceSet when owner is a string');
            }
            const existingSet = this.endpointSourceSets.get(owner);
            if (existingSet) {
                // In Kotlin: existingSet += endpointSourceSet uses operator overloading.
                // We need to define how EndpointSourceSets are merged. Assume an 'add' method or similar.
                this.endpointSourceSets.set(owner, existingSet.add(endpointSourceSet)); // Requires EndpointSourceSet.add()
            } else {
                this.endpointSourceSets.set(owner, endpointSourceSet);
            }
        } else if (ownerOrOther instanceof ConferenceSourceMap) {
            const otherMap = ownerOrOther;
            otherMap.forEach((set, owner) => {
                this.add(owner, set); // Recursive call with string owner
            });
        } else {
            throw new Error('Invalid arguments for add');
        }
    }

    /**
     * Removes sources. If ownerOrOther is a string, removes all sources for that owner.
     * If ownerOrOther is another ConferenceSourceMap, removes matching sources.
     * @param {string | ConferenceSourceMap} ownerOrOther
     * @param {EndpointSourceSet} [endpointSourceSetToRemove] - If ownerOrOther is string, specifies particular set to remove from owner's set
     */
    remove(ownerOrOther, endpointSourceSetToRemove) {
        if (typeof ownerOrOther === 'string') {
            const owner = ownerOrOther;
            if (endpointSourceSetToRemove instanceof EndpointSourceSet) { // Remove specific subset
                const existingSet = this.endpointSourceSets.get(owner);
                if (existingSet) {
                    const resultSet = existingSet.remove(endpointSourceSetToRemove); // Requires EndpointSourceSet.remove()
                    if (resultSet.isEmpty()) {
                        this.endpointSourceSets.delete(owner);
                    } else {
                        this.endpointSourceSets.set(owner, resultSet);
                    }
                }
            } else { // Remove all for owner
                return this.endpointSourceSets.delete(owner);
            }
        } else if (ownerOrOther instanceof ConferenceSourceMap) {
            const otherMap = ownerOrOther;
            otherMap.forEach((set, owner) => {
                this.remove(owner, set); // Recursive call
            });
        } else {
            throw new Error('Invalid arguments for remove');
        }
    }

    get size() {
        return this.endpointSourceSets.size;
    }

    isEmpty() {
        return this.endpointSourceSets.size === 0;
    }

    forEach(callbackfn) { // callbackfn: (value: EndpointSourceSet, key: string, map: Map<string, EndpointSourceSet>) => void
        this.endpointSourceSets.forEach(callbackfn);
    }

    copy() {
        const newMapData = new Map();
        this.endpointSourceSets.forEach((value, key) => {
            newMapData.set(key, value.copy()); // EndpointSourceSet must have copy()
        });
        return new ConferenceSourceMap(newMapData);
    }

    /**
     * Creates a list of Jingle <content> XML elements.
     * @returns {Element[]}
     */
    toJingle() {
        const mediaTypeToContentMap = new Map(); // Map<MediaType, Element (content)>

        this.endpointSourceSets.forEach((sourceSet, ownerEndpointId) => {
            // EndpointSourceSet.toJingleContents needs to populate mediaTypeToContentMap
            sourceSet.toJingleContents(mediaTypeToContentMap, ownerEndpointId);
        });
        return Array.from(mediaTypeToContentMap.values());
    }

    compactJson() {
        const entries = [];
        this.endpointSourceSets.forEach((set, owner) => {
            entries.push(`"${owner}":${set.compactJson}`);
        });
        return `{${entries.join(',')}}`;
    }

    toJson() {
        const obj = {};
        this.endpointSourceSets.forEach((set, owner) => {
            obj[owner] = set.toJson();
        });
        return obj; // Could wrap in an OrderedJsonObject equivalent if order is critical everywhere
    }

    stripSimulcast() {
        this.endpointSourceSets.forEach((sourceSet, owner) => {
            this.endpointSourceSets.set(owner, sourceSet.stripSimulcast()); // Assumes stripSimulcast returns new/modified set
        });
        return this; // For chaining, as in Kotlin
    }

    stripByMediaType(retainMediaTypesSet) { // retainMediaTypesSet is a Set of MediaType strings
        this.endpointSourceSets.forEach((sourceSet, owner) => {
            const newSet = sourceSet.stripByMediaType(retainMediaTypesSet);
            if (newSet.isEmpty()) {
                this.endpointSourceSets.delete(owner);
            } else {
                this.endpointSourceSets.set(owner, newSet);
            }
        });
        return this;
    }

    map(transformFn) { // transformFn: (EndpointSourceSet) => EndpointSourceSet
         this.endpointSourceSets.forEach((sourceSet, owner) => {
            const transformed = transformFn(sourceSet);
            if (transformed.isEmpty()) {
                this.endpointSourceSets.delete(owner);
            } else {
                this.endpointSourceSets.set(owner, transformed);
            }
        });
        return this;
    }

    // TODO: UnmodifiableConferenceSourceMap equivalent if strictly needed.
    // For now, users of this class should be mindful not to mutate if an unmodifiable view is required.
}

module.exports = ConferenceSourceMap;
