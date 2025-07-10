const ConferenceSourceMap = require('./conferenceSourceMap');
const EndpointSourceSet = require('./endpointSourceSet');
const { SsrcGroupSemantics } = require('./ssrcGroupSemantics');
const MediaType = require('./mediaType');
const loggerModule = require('../../../utils/logger'); // Assuming a logger is needed

// --- Custom Error Classes ---
class ValidationFailedError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}
class InvalidSsrcError extends ValidationFailedError {
    constructor(ssrc) { super(`Invalid SSRC: ${ssrc}.`); this.ssrc = ssrc; }
}
class SsrcLimitExceededError extends ValidationFailedError {
    constructor(limit) { super(`SSRC limit (${limit}) exceeded.`); this.limit = limit; }
}
class SsrcGroupLimitExceededError extends ValidationFailedError {
    constructor(limit) { super(`SSRC group limit (${limit}) exceeded.`); this.limit = limit; }
}
class SsrcAlreadyUsedError extends ValidationFailedError {
    constructor(ssrc) { super(`SSRC is already used: ${ssrc}.`); this.ssrc = ssrc; }
}
class RequiredParameterMissingError extends ValidationFailedError {
    constructor(name) { super(`Required source parameter '${name}' is not present.`); this.paramName = name; }
}
class GroupMsidMismatchError extends ValidationFailedError {
    constructor(ssrcs) { super(`SSRC group contains sources with different MSIDs: ${ssrcs.join(',')}.`); this.ssrcs = ssrcs; }
}
class MsidConflictError extends ValidationFailedError {
    constructor(msid) { super(`MSID is already used: ${msid}.`); this.msid = msid; }
}
class GroupContainsUnknownSourceError extends ValidationFailedError {
    constructor(groupSsrcs) { super(`An SSRC group contains an SSRC which hasn't been signaled as a source: ${groupSsrcs.join(',')}.`); this.groupSsrcs = groupSsrcs; }
}
class InvalidFidGroupError extends ValidationFailedError {
    constructor(groupSsrcs) { super(`Invalid FID group (must have 2 SSRCs): ${groupSsrcs.join(',')}.`); this.groupSsrcs = groupSsrcs; }
}
class SourceDoesNotExistError extends ValidationFailedError {
    constructor(ssrc = null) { super(`Source does not exist or is not owned by endpoint${ssrc !== null ? ` (ssrc=${ssrc})` : ''}.`); this.ssrc = ssrc;}
}
class SourceGroupDoesNotExistError extends ValidationFailedError {
    constructor() { super("Source group does not exist."); }
}
// --- End Custom Error Classes ---


class ValidatingConferenceSourceMap extends ConferenceSourceMap {
    constructor(maxSsrcsPerUser, maxSsrcGroupsPerUser) {
        super(); // Call ConferenceSourceMap constructor
        this.maxSsrcsPerUser = maxSsrcsPerUser;
        this.maxSsrcGroupsPerUser = maxSsrcGroupsPerUser;
        this.logger = loggerModule.child({ component: 'ValidatingConferenceSourceMap' });

        /** @private @type {Map<number, string>} SSRC -> ownerEndpointId */
        this.ssrcToOwnerMap = new Map();
        /** @private @type {Map<string, string>} MSID -> ownerEndpointId */
        this.msidToOwnerMap = new Map();
    }

    /**
     * @private
     * Updates owner maps after an EndpointSourceSet has been added for an owner.
     */
    _sourceSetAdded(owner, endpointSourceSet) {
        endpointSourceSet.sources.forEach(source => {
            this.ssrcToOwnerMap.set(source.ssrc, owner);
            if (source.msid) {
                this.msidToOwnerMap.set(source.msid, owner);
            }
        });
    }

    /**
     * @private
     * Updates owner maps after an EndpointSourceSet has been removed for an owner.
     */
    _sourceSetRemoved(owner, removedEndpointSourceSet) {
        const ownerRemainingSourceSet = super.get(owner); // Get what's left from the parent map

        removedEndpointSourceSet.sources.forEach(source => {
            this.ssrcToOwnerMap.delete(source.ssrc);
            if (source.msid) {
                // Only remove MSID mapping if no other source from this owner uses this MSID
                let msidStillInUseByOwner = false;
                if (ownerRemainingSourceSet) {
                    for (const remainingSource of ownerRemainingSourceSet.sources) {
                        if (remainingSource.msid === source.msid) {
                            msidStillInUseByOwner = true;
                            break;
                        }
                    }
                }
                if (!msidStillInUseByOwner) {
                    this.msidToOwnerMap.delete(source.msid);
                }
            }
        });
    }

    /**
     * Adds sources. Overridden to update owner maps.
     * Does NOT perform full validation like tryToAdd.
     */
    add(ownerOrOther, endpointSourceSet) {
        if (typeof ownerOrOther === 'string') {
            const owner = ownerOrOther;
            const setToAdd = endpointSourceSet; // Assuming it's already an EndpointSourceSet instance

            const existingSet = super.get(owner) || EndpointSourceSet.EMPTY;
            const newSet = existingSet.add(setToAdd); // EndpointSourceSet.add returns a new instance
            super.set(owner, newSet);
            this._sourceSetAdded(owner, setToAdd); // Track based on what was actually added/merged
        } else if (ownerOrOther instanceof ConferenceSourceMap) {
            const otherMap = ownerOrOther;
            otherMap.forEach((set, owner) => {
                this.add(owner, set); // Recursive call
            });
        } else {
            throw new Error('Invalid arguments for ValidatingConferenceSourceMap.add');
        }
    }

    /**
     * Removes sources. Overridden to update owner maps.
     * Does NOT perform full validation like tryToRemove.
     */
    remove(ownerOrOther, endpointSourceSetToRemove) {
        if (typeof ownerOrOther === 'string') {
            const owner = ownerOrOther;
            if (endpointSourceSetToRemove instanceof EndpointSourceSet) {
                const existingSet = super.get(owner);
                if (existingSet) {
                    const newSet = existingSet.remove(endpointSourceSetToRemove);
                    if (newSet.isEmpty()) {
                        super.remove(owner); // Call parent's remove(owner)
                    } else {
                        super.set(owner, newSet);
                    }
                    this._sourceSetRemoved(owner, endpointSourceSetToRemove.remove(newSet)); // What was actually removed
                }
            } else { // Remove all for owner
                const removedSet = super.get(owner); // Get before removing
                if (removedSet) {
                    const success = super.remove(owner);
                    if (success) {
                        this._sourceSetRemoved(owner, removedSet);
                    }
                    return removedSet; // Return what was removed as per parent's signature for remove(owner)
                }
                return null;
            }
        } else if (ownerOrOther instanceof ConferenceSourceMap) {
            const otherMap = ownerOrOther;
            otherMap.forEach((set, owner) => {
                this.remove(owner, set); // Recursive call
            });
        } else {
            throw new Error('Invalid arguments for ValidatingConferenceSourceMap.remove');
        }
    }

    /**
     * Attempts to add sources with validation.
     * @throws {ValidationFailedError}
     * @returns {EndpointSourceSet} The accepted subset of sourcesToAdd.
     */
    tryToAdd(owner, sourcesToAdd) {
        if (!(sourcesToAdd instanceof EndpointSourceSet)) {
            throw new TypeError("sourcesToAdd must be an EndpointSourceSet");
        }

        const existingSourceSet = super.get(owner) || EndpointSourceSet.EMPTY;

        // Check for SSRC validity and conflicts with *other* endpoints
        for (const source of sourcesToAdd.sources) {
            if (source.ssrc <= 0 || source.ssrc >= 0x100000000) { // JS max safe int is larger, but 32-bit range for SSRC
                throw new InvalidSsrcError(source.ssrc);
            }
            const ssrcOwner = this.ssrcToOwnerMap.get(source.ssrc);
            if (ssrcOwner && ssrcOwner !== owner) { // Conflict with another owner
                throw new SsrcAlreadyUsedError(source.ssrc);
            }
            // Also check if this owner is trying to re-add an SSRC they already own (but maybe with different attributes)
            // The current logic of EndpointSourceSet.add might handle this by merging or set uniqueness.
            // If the exact same Source object (by reference or uniqueKey) is added, Set handles it.
            // If it's a new Source object with same SSRC but different MSID, validateEndpointSourceSet should catch it.


            if (source.msid) {
                const msidOwner = this.msidToOwnerMap.get(source.msid);
                if (msidOwner && msidOwner !== owner) {
                    throw new MsidConflictError(source.msid);
                }
            }
        }

        // Check SSRC limits for this owner
        const tempCombinedSources = new Set(existingSourceSet.sources);
        sourcesToAdd.sources.forEach(s => tempCombinedSources.add(s)); // Relies on Source objects being unique if SSRCs are same but other attrs differ
        if (tempCombinedSources.size > this.maxSsrcsPerUser) { // This counts unique Source objects, not unique SSRCs. Kotlin was existingSourceSet.sources.size + sourcesToAdd.sources.size
                                                          // Let's use unique SSRCs for the limit check.
            const combinedUniqueSsrcs = new Set([...existingSourceSet.sources, ...sourcesToAdd.sources].map(s => s.ssrc));
            if (combinedUniqueSsrcs.size > this.maxSsrcsPerUser) {
                throw new SsrcLimitExceededError(this.maxSsrcsPerUser);
            }
        }


        // Filter accepted groups (ignore empty, duplicates, or groups with unknown SSRCs)
        // SSRCs for validation must come from the combined set of existing and new sources for the owner.
        const allPotentialSourcesForOwner = new EndpointSourceSet(
            new Set([...existingSourceSet.sources, ...sourcesToAdd.sources])
        );
        const resultingSsrcsForGroupValidation = new Set();
        allPotentialSourcesForOwner.sources.forEach(s => resultingSsrcsForGroupValidation.add(s.ssrc));

        const acceptedGroups = new Set();
        for (const group of sourcesToAdd.ssrcGroups) {
            if (group.ssrcs.length === 0) {
                this.logger.info(`Empty group signaled by ${owner}, ignoring: ${group.toString()}`);
                continue;
            }
            if (existingSourceSet.ssrcGroups.has(group.uniqueKey)) { // Check for duplicate group by uniqueKey
                this.logger.info(`Duplicate group signaled by ${owner}, ignoring: ${group.toString()}`);
                continue;
            }
            for (const ssrc of group.ssrcs) {
                if (!resultingSsrcsForGroupValidation.has(ssrc)) {
                    throw new GroupContainsUnknownSourceError(group.ssrcs);
                }
            }
            acceptedGroups.add(group);
        }

        // Check SSRC group limits for this owner
        if (existingSourceSet.ssrcGroups.size + acceptedGroups.size > this.maxSsrcGroupsPerUser) {
            throw new SsrcGroupLimitExceededError(this.maxSsrcGroupsPerUser);
        }

        // Create the potential new state for this owner
        const finalSourcesForOwner = new Set([...existingSourceSet.sources]);
        sourcesToAdd.sources.forEach(s => { // Add new sources, relying on Set uniqueness for Source objects
            // To truly merge based on SSRC (e.g. update attributes if SSRC exists), more logic is needed here.
            // For now, if a Source object with the same uniqueKey exists, it won't be added again by Set.
            // If it's a different Source object for the same SSRC, it would be added.
            // The SsrcAlreadyUsedError should catch cross-owner conflicts.
            // Internal conflicts (owner re-adding same SSRC, maybe with different msid) needs careful thought.
            // The Kotlin code seems to add to the existing set: existingSourceSet.sources + acceptedSources
            finalSourcesForOwner.add(s);
        });

        const finalGroupsForOwner = new Set([...existingSourceSet.ssrcGroups]);
        acceptedGroups.forEach(g => finalGroupsForOwner.add(g));

        const resultingSourceSet = new EndpointSourceSet(finalSourcesForOwner, finalGroupsForOwner);

        // Validate the final set for this owner
        ValidatingConferenceSourceMap.validateEndpointSourceSet(resultingSourceSet);

        // If all checks pass, commit the changes
        const acceptedSourceSet = new EndpointSourceSet(sourcesToAdd.sources, acceptedGroups);
        this.add(owner, acceptedSourceSet); // This will call the overridden add, which updates owner maps

        return acceptedSourceSet;
    }

    /**
     * Attempts to remove sources with validation.
     * @throws {ValidationFailedError}
     * @returns {EndpointSourceSet} The sources that were actually removed.
     */
    tryToRemove(owner, sourcesToRemove) {
        if (!(sourcesToRemove instanceof EndpointSourceSet)) {
            throw new TypeError("sourcesToRemove must be an EndpointSourceSet");
        }
        if (sourcesToRemove.isEmpty()) return EndpointSourceSet.EMPTY;

        const existingSet = super.get(owner);
        if (!existingSet || existingSet.isEmpty()) {
            throw new SourceDoesNotExistError();
        }

        const sourcesAcceptedToBeRemoved = new Set();
        for (const source of sourcesToRemove.sources) {
            const existingSource = Array.from(existingSet.sources).find(s => s.ssrc === source.ssrc);
            if (!existingSource) throw new SourceDoesNotExistError(source.ssrc);
            sourcesAcceptedToBeRemoved.add(existingSource); // Add the actual object from our map
        }
        const ssrcsAcceptedForRemovalNumbers = Array.from(sourcesAcceptedToBeRemoved).map(s => s.ssrc);

        const groupsAcceptedToBeRemoved = new Set();
        for (const group of sourcesToRemove.ssrcGroups) {
            const existingGroup = Array.from(existingSet.ssrcGroups).find(g => g.uniqueKey === group.uniqueKey);
            if (!existingGroup) throw new SourceGroupDoesNotExistError();
            groupsAcceptedToBeRemoved.add(existingGroup);
        }

        // Auto-remove groups containing any of the removed SSRCs
        existingSet.ssrcGroups.forEach(existingGroup => {
            if (!groupsAcceptedToBeRemoved.has(existingGroup.uniqueKey)) { // Don't re-check if already marked
                for (const ssrc of existingGroup.ssrcs) {
                    if (ssrcsAcceptedForRemovalNumbers.includes(ssrc)) {
                        groupsAcceptedToBeRemoved.add(existingGroup);
                        break;
                    }
                }
            }
        });

        const tempSources = new Set();
        existingSet.sources.forEach(s => {
            if (!Array.from(sourcesAcceptedToBeRemoved).find(rem => rem.ssrc === s.ssrc)) tempSources.add(s);
        });
        const tempGroups = new Set();
        existingSet.ssrcGroups.forEach(g => {
             if (!Array.from(groupsAcceptedToBeRemoved).find(rem => rem.uniqueKey === g.uniqueKey)) tempGroups.add(g);
        });

        const resultingSourceSet = new EndpointSourceSet(tempSources, tempGroups);
        ValidatingConferenceSourceMap.validateEndpointSourceSet(resultingSourceSet);

        // If all checks pass, commit the removal
        const actualRemovedSet = new EndpointSourceSet(sourcesAcceptedToBeRemoved, groupsAcceptedToBeRemoved);
        this.remove(owner, actualRemovedSet); // Uses overridden remove, which updates owner maps

        return actualRemovedSet;
    }


    /**
     * Static validation for a single EndpointSourceSet.
     * @throws {ValidationFailedError}
     */
    static validateEndpointSourceSet(endpointSourceSet) {
        if (!(endpointSourceSet instanceof EndpointSourceSet)) {
            throw new TypeError("validateEndpointSourceSet expects an EndpointSourceSet instance");
        }

        const ssrcToSourceLookup = new Map();
        endpointSourceSet.sources.forEach(s => ssrcToSourceLookup.set(s.ssrc, s));

        for (const group of endpointSourceSet.ssrcGroups) {
            if (group.ssrcs.length === 0) {
                // This should ideally be caught by group creation logic if it's invalid
                throw new ValidationFailedError("SSRC group cannot be empty.");
            }
            let groupMsid = null;
            for (const ssrc of group.ssrcs) {
                const source = ssrcToSourceLookup.get(ssrc);
                if (!source) {
                    // This case should be caught by tryToAdd's GroupContainsUnknownSourceError check before this static validation
                    throw new GroupContainsUnknownSourceError(group.ssrcs);
                }
                if (group.semantics === SsrcGroupSemantics.Fid && group.ssrcs.length !== 2) {
                    throw new InvalidFidGroupError(group.ssrcs);
                }
                if (!source.msid) { // Grouped sources must have MSID
                    throw new RequiredParameterMissingError(`msid for SSRC ${ssrc} in group ${group.toString()}`);
                }
                if (groupMsid === null) {
                    groupMsid = source.msid;
                } else if (source.msid !== groupMsid) {
                    throw new GroupMsidMismatchError(group.ssrcs);
                }
            }
        }

        // Check for MSID conflicts within the same media type for different "streams" (SIM groups or standalone MSIDs)
        [MediaType.AUDIO, MediaType.VIDEO].forEach(mediaType => {
            const mediaTypeSources = Array.from(endpointSourceSet.sources).filter(s => s.mediaType === mediaType && s.msid);

            // Group sources by their "stream" concept (a SIM group, or a standalone source if not in SIM)
            const streams = new Map(); // streamKey (e.g. SIM group key or source SSRC) -> { msid, sourcesInStream[] }

            mediaTypeSources.forEach(source => {
                let mainSsrcForStream = source.ssrc;
                let representativeGroup = null;

                // Find if this source belongs to a SIM group
                for (const group of endpointSourceSet.ssrcGroups) {
                    if (group.mediaType === mediaType && group.semantics === SsrcGroupSemantics.Simulcast && group.ssrcs.includes(source.ssrc)) {
                        representativeGroup = group;
                        mainSsrcForStream = group.ssrcs[0]; // Use primary SSRC of SIM group as key
                        break;
                    }
                }
                // If not in SIM, but in FID, its FID group is its stream key (if primary) or part of primary's stream
                if (!representativeGroup) {
                    for (const group of endpointSourceSet.ssrcGroups) {
                         if (group.mediaType === mediaType && group.semantics === SsrcGroupSemantics.Fid && group.ssrcs.includes(source.ssrc)) {
                            representativeGroup = group;
                            mainSsrcForStream = group.ssrcs[0]; // Use primary SSRC of FID group
                            break;
                        }
                    }
                }

                const streamKey = representativeGroup ? representativeGroup.uniqueKey : `source-${mainSsrcForStream}`;

                if (!streams.has(streamKey)) {
                    streams.set(streamKey, { msid: source.msid, sources: [] });
                }
                streams.get(streamKey).sources.push(source);
            });

            const msidsSeenInMediaType = new Set();
            for (const stream of streams.values()) {
                if (msidsSeenInMediaType.has(stream.msid)) {
                    throw new MsidConflictError(`${stream.msid} (media type: ${mediaType})`);
                }
                msidsSeenInMediaType.add(stream.msid);
            }
        });
    }
}

module.exports = {
    ValidatingConferenceSourceMap,
    ValidationFailedError,
    InvalidSsrcError,
    SsrcLimitExceededError,
    SsrcGroupLimitExceededError,
    SsrcAlreadyUsedError,
    RequiredParameterMissingError,
    GroupMsidMismatchError,
    MsidConflictError,
    GroupContainsUnknownSourceError,
    InvalidFidGroupError,
    SourceDoesNotExistError,
    SourceGroupDoesNotExistError
};
