const logger = require('../utils/logger');

/** An action -- add or remove. */
const AddOrRemove = {
    Add: 'Add',
    Remove: 'Remove'
};

/**
 * Holds a ConferenceSourceMap together with an action specifying if the sources are to be added or removed.
 */
class SourcesToAddOrRemove {
    /**
     * @param {string} action - The action (AddOrRemove.Add or AddOrRemove.Remove)
     * @param {Object} sources - The ConferenceSourceMap
     */
    constructor(action, sources) {
        this.action = action;
        this.sources = sources;
    }

    /**
     * Get the debug state as a JSON object
     * @returns {Object} - The debug state
     */
    get debugState() {
        return {
            action: this.action.toString(),
            sources: this.sources.toJson ? this.sources.toJson() : this.sources
        };
    }

    /**
     * Check if this is an add action
     * @returns {boolean} - True if this is an add action
     */
    isAdd() {
        return this.action === AddOrRemove.Add;
    }

    /**
     * Check if this is a remove action
     * @returns {boolean} - True if this is a remove action
     */
    isRemove() {
        return this.action === AddOrRemove.Remove;
    }

    /**
     * Get the sources as an array
     * @returns {Array} - The sources array
     */
    getSourcesArray() {
        if (this.sources && typeof this.sources.toArray === 'function') {
            return this.sources.toArray();
        }
        return this.sources || [];
    }

    /**
     * Get the number of sources
     * @returns {number} - The number of sources
     */
    getSourceCount() {
        const sourcesArray = this.getSourcesArray();
        return sourcesArray.length;
    }

    /**
     * Check if this has any sources
     * @returns {boolean} - True if there are sources
     */
    hasSources() {
        return this.getSourceCount() > 0;
    }

    /**
     * Convert to a simple object for serialization
     * @returns {Object} - The serialized object
     */
    toJson() {
        return {
            action: this.action,
            sources: this.sources,
            sourceCount: this.getSourceCount(),
            hasSources: this.hasSources()
        };
    }

    /**
     * Create an add action
     * @param {Object} sources - The sources to add
     * @returns {SourcesToAddOrRemove} - A new instance for adding sources
     */
    static createAdd(sources) {
        return new SourcesToAddOrRemove(AddOrRemove.Add, sources);
    }

    /**
     * Create a remove action
     * @param {Object} sources - The sources to remove
     * @returns {SourcesToAddOrRemove} - A new instance for removing sources
     */
    static createRemove(sources) {
        return new SourcesToAddOrRemove(AddOrRemove.Remove, sources);
    }
}

module.exports = {
    SourcesToAddOrRemove,
    AddOrRemove
}; 