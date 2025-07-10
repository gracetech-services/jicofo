const ConferenceSourceMap = require('../common/conference/source/conferenceSourceMap');
const MediaType = require('../common/conference/source/mediaType');
// No direct need for JSONObject/JSONArray from json-simple, will use native JS objects/arrays.

const AddOrRemove = Object.freeze({
    ADD: 'add',
    REMOVE: 'remove'
});

class SourcesToAddOrRemove {
    /**
     * @param {'add'|'remove'} action
     * @param {ConferenceSourceMap} sources
     */
    constructor(action, sources) {
        if (!Object.values(AddOrRemove).includes(action)) {
            throw new Error(`Invalid action: ${action}`);
        }
        if (!(sources instanceof ConferenceSourceMap)) {
            throw new Error('Sources must be an instance of ConferenceSourceMap');
        }
        this.action = action;
        this.sources = sources;
    }
}

class SourceSignaling {
    /**
     * @param {boolean} [audioSupported=true] - Whether the remote endpoint supports audio.
     * @param {boolean} [videoSupported=true] - Whether the remote endpoint supports video.
     * @param {boolean} [stripSimulcast=true] - Whether to strip simulcast layers before comparing/signaling.
     */
    constructor(audioSupported = true, videoSupported = true, stripSimulcast = true) {
        this.supportedMediaTypes = new Set();
        if (audioSupported) this.supportedMediaTypes.add(MediaType.AUDIO);
        if (videoSupported) this.supportedMediaTypes.add(MediaType.VIDEO);

        this.stripSimulcast = stripSimulcast;

        /** @private @type {ConferenceSourceMap} */
        this.signaledSources = new ConferenceSourceMap();
        /** @private @type {ConferenceSourceMap} */
        this.updatedSources = new ConferenceSourceMap();
    }

    /**
     * Adds sources to the desired state.
     * @param {ConferenceSourceMap} sourcesToAdd
     */
    addSources(sourcesToAdd) {
        if (!(sourcesToAdd instanceof ConferenceSourceMap)) {
            throw new Error('sourcesToAdd must be an instance of ConferenceSourceMap');
        }
        this.updatedSources.add(sourcesToAdd); // Uses ConferenceSourceMap's add method
    }

    /**
     * Removes sources from the desired state.
     * @param {ConferenceSourceMap} sourcesToRemove
     */
    removeSources(sourcesToRemove) {
        if (!(sourcesToRemove instanceof ConferenceSourceMap)) {
            throw new Error('sourcesToRemove must be an instance of ConferenceSourceMap');
        }
        this.updatedSources.remove(sourcesToRemove); // Uses ConferenceSourceMap's remove method
    }

    /**
     * Compares the currently signaled state with the desired updated state (after filtering)
     * and returns a list of operations (add/remove) needed to reach the updated state.
     * After this call, the internal signaled state is updated to the new desired state.
     * @returns {SourcesToAddOrRemove[]}
     */
    update() {
        const filteredSignaled = this._filter(this.signaledSources);
        const filteredUpdated = this._filter(this.updatedSources);

        // sourcesToAdd = filteredUpdated - filteredSignaled
        const sourcesToAddMap = filteredUpdated.copy(); // Start with everything in updated
        sourcesToAddMap.remove(filteredSignaled);    // Remove what was already signaled

        // sourcesToRemove = filteredSignaled - filteredUpdated
        const sourcesToRemoveMap = filteredSignaled.copy(); // Start with everything signaled
        sourcesToRemoveMap.remove(filteredUpdated);      // Remove what's still in updated

        this.reset(this.updatedSources); // Update signaledSources to the new (unfiltered) desired state

        const operations = [];
        if (!sourcesToRemoveMap.isEmpty()) {
            operations.push(new SourcesToAddOrRemove(AddOrRemove.REMOVE, sourcesToRemoveMap));
        }
        if (!sourcesToAddMap.isEmpty()) {
            operations.push(new SourcesToAddOrRemove(AddOrRemove.ADD, sourcesToAddMap));
        }
        return operations;
    }

    /**
     * Resets the signaled and updated states to a new ConferenceSourceMap.
     * @param {ConferenceSourceMap} newSourcesMap
     * @returns {ConferenceSourceMap} The filtered version of newSourcesMap.
     */
    reset(newSourcesMap) {
        if (!(newSourcesMap instanceof ConferenceSourceMap)) {
            throw new Error('newSourcesMap must be an instance of ConferenceSourceMap');
        }
        this.signaledSources = newSourcesMap.copy();
        this.updatedSources = newSourcesMap.copy();
        return this._filter(newSourcesMap);
    }

    /**
     * @private
     * Filters a ConferenceSourceMap based on supported media types and stripSimulcast flag.
     * @param {ConferenceSourceMap} conferenceSourceMap
     * @returns {ConferenceSourceMap} A new, filtered ConferenceSourceMap.
     */
    _filter(conferenceSourceMap) {
        const filtered = conferenceSourceMap.copy();
        filtered.stripByMediaType(this.supportedMediaTypes);
        if (this.stripSimulcast) {
            filtered.stripSimulcast();
        }
        return filtered;
    }

    get debugState() {
        return {
            signaled_sources: this.signaledSources.toJson(), // Assuming toJson returns a JS object
            updated_sources: this.updatedSources.toJson(),   // Assuming toJson returns a JS object
            supported_media_types: Array.from(this.supportedMediaTypes)
        };
    }
}

module.exports = {
    SourceSignaling,
    SourcesToAddOrRemove,
    AddOrRemove
};
