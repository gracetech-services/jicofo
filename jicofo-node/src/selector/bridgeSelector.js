const loggerModule = require('../utils/logger');
// const Bridge = require('./bridge/bridge'); // Assuming Bridge class is in a subfolder or same level

/**
 * Responsible for selecting the best Jitsi Videobridge (JVB) for a new participant
 * or for moving existing participants.
 *
 * It maintains a list of available bridges and uses a selection strategy.
 */
class BridgeSelector {
    constructor(jicofoSrv) {
        this.jicofoSrv = jicofoSrv;
        this.logger = loggerModule.child({ component: 'BridgeSelector' });
        this.config = this.jicofoSrv.jicofoConfig; // Cache a reference to the config accessor

        /** @private @type {Map<string, Bridge>} JID string -> Bridge instance */
        this.availableBridges = new Map();

        // TODO: Later, this could be replaced by a pluggable strategy object.
        // For now, the logic is within selectBridge.

        this.logger.info('BridgeSelector created.');
    }

    /**
     * Adds a bridge to the list of available bridges.
     * @param {Bridge} bridge - The Bridge instance to add.
     */
    addBridge(bridge) {
        if (!bridge || !bridge.getJid()) {
            this.logger.error('Attempted to add an invalid bridge object.');
            return;
        }
        if (this.availableBridges.has(bridge.getJid())) {
            this.logger.warn(`Bridge ${bridge.getJid()} already known. Updating instance.`);
        }
        this.availableBridges.set(bridge.getJid(), bridge);
        this.logger.info(`Bridge added/updated: ${bridge.getJid()}. Total available: ${this.availableBridges.size}`);
        // TODO: Notify strategy if it needs explicit updates.
    }

    /**
     * Removes a bridge from the list of available bridges.
     * @param {Bridge} bridge - The Bridge instance to remove.
     */
    removeBridge(bridge) {
        if (!bridge || !bridge.getJid()) {
            this.logger.error('Attempted to remove an invalid bridge object.');
            return;
        }
        if (this.availableBridges.delete(bridge.getJid())) {
            this.logger.info(`Bridge removed: ${bridge.getJid()}. Total available: ${this.availableBridges.size}`);
            // TODO: Notify strategy.
        } else {
            this.logger.warn(`Attempted to remove unknown bridge: ${bridge.getJid()}`);
        }
    }

    /**
     * Selects a bridge for a participant.
     * @param {Map<Bridge, object>} conferenceBridges - Map of Bridge instances already used by the conference
     *                                                to their properties (e.g., participantCount, isVisitorSession).
     * @param {object} participantProperties - Properties of the participant needing a bridge.
     *                                         { region?: string, visitor?: boolean }
     * @param {string|null} pinnedBridgeVersion - An optional specific JVB version the conference is pinned to.
     * @returns {Bridge|null} The selected Bridge instance, or null if no suitable bridge is found.
     */
    selectBridge(conferenceBridges = new Map(), participantProperties = {}, pinnedBridgeVersion = null) {
        this.logger.info(
            `Selecting bridge. Conference already uses ${conferenceBridges.size} bridges. ` +
            `Participant props: region=${participantProperties.region}, visitor=${participantProperties.visitor}. ` +
            `Pinned version: ${pinnedBridgeVersion || 'none'}.`
        );

        // --- Very Basic Placeholder Strategy ---
        // 1. Prefer operational bridges.
        // 2. If pinned version, only consider those matching.
        // 3. If participant has a region, prefer bridges in that region.
        // This method implements a selection strategy.
        // For now, a simplified version of region-based preference with version pinning.

        let candidateBridges = Array.from(this.availableBridges.values()).filter(
            b => b.isOperational // isOperational getter already checks !isInGracefulShutdown
        );

        if (candidateBridges.length === 0) {
            this.logger.warn('No operational bridges available.');
            return null;
        }

        // 1. Filter by max stress
        const maxStress = this.config.getOptionalConfig('bridge.maxBridgeStress', 0.85);
        candidateBridges = candidateBridges.filter(b => (b.stress || 0) <= maxStress);
        if (candidateBridges.length === 0) {
            this.logger.warn(`No operational bridges at or below max stress ${maxStress}.`);
            // Optionally, could try again with a higher threshold or ignore stress if this is critical
            return null;
        }
        this.logger.debug(`${candidateBridges.length} bridges after stress filter (max ${maxStress}).`);


        // 2. Apply version pinning if specified
        if (pinnedBridgeVersion) {
            const versionPinnedCandidates = candidateBridges.filter(b => b.getVersion() === pinnedBridgeVersion);
            if (versionPinnedCandidates.length === 0) {
                this.logger.warn(
                    `No operational bridges (under stress limit) match pinned version "${pinnedBridgeVersion}".`
                );
                if (!this.config.getOptionalConfig('bridge.allowSelectionIfNoPinnedMatch', false)) {
                    return null;
                }
                // If allowSelectionIfNoPinnedMatch is true, we continue with the candidates list before version pinning.
                this.logger.info(`Proceeding without version pinning due to 'allowSelectionIfNoPinnedMatch' config.`);
            } else {
                candidateBridges = versionPinnedCandidates;
                this.logger.info(`Filtered candidates by pinned version "${pinnedBridgeVersion}", ${candidateBridges.length} remaining.`);
            }
        }

        const participantRegion = participantProperties.region;
        const isVisitor = participantProperties.visitor === true;

        // Separate candidates into those already in the conference and those not.
        const inConferenceBridgeInstances = Array.from(conferenceBridges.keys());

        const inConferenceCandidates = candidateBridges.filter(b => inConferenceBridgeInstances.includes(b));
        const newBridgeCandidates = candidateBridges.filter(b => !inConferenceBridgeInstances.includes(b));

        // Sort function for load balancing:
        // Primary: by stress level (lower is better).
        // Secondary: by participant count IF bridge is already in conference (lower is better).
        // (For new bridges, participantCount from conferenceBridges will be undefined).
        const sortByLoad = (bridgeA, bridgeB) => {
            const stressA = bridgeA.stress || 0; // Default to 0 if undefined
            const stressB = bridgeB.stress || 0;

            if (stressA !== stressB) {
                return stressA - stressB;
            }

            // If stress is equal, prefer by participant count for bridges in conference
            const loadA = conferenceBridges.get(bridgeA)?.participantCount;
            const loadB = conferenceBridges.get(bridgeB)?.participantCount;

            if (loadA !== undefined && loadB !== undefined) {
                return loadA - loadB;
            } else if (loadA !== undefined) { // bridgeA is in conference, bridgeB is new
                return -1; // Prefer existing if stress is same
            } else if (loadB !== undefined) { // bridgeB is in conference, bridgeA is new
                return 1;  // Prefer existing if stress is same
            }
            return 0; // Both new or no participant count info
        };

        // --- Selection Strategy ---
        // Helper to select the best candidate from a list
        const selectBestFrom = (candidates, logMessagePrefix) => {
            if (candidates.length === 0) return null;
            candidates.sort(sortByLoad);
            const best = candidates[0];
            this.logger.info(`${logMessagePrefix} ${best.getJid()} (stress: ${best.stress}, conference_participants: ${conferenceBridges.get(best)?.participantCount || 'N/A'}).`);
            return best;
        };

        // 1. Prefer bridge in participant's region already used by the conference.
        if (participantRegion) {
            const regionalInConference = inConferenceCandidates.filter(b => b.getRegion() === participantRegion);
            const best = selectBestFrom(regionalInConference, `Selected existing conference bridge in participant region ${participantRegion}:`);
            if (best) return best;
        }

        // 2. Prefer any bridge already used by the conference.
        const bestInConference = selectBestFrom(inConferenceCandidates, "Selected existing conference bridge:");
        if (bestInConference) return bestInConference;

        // 3. Prefer new bridge in participant's region.
        if (participantRegion) {
            const regionalNew = newBridgeCandidates.filter(b => b.getRegion() === participantRegion);
            const best = selectBestFrom(regionalNew, `Selected new bridge in participant region ${participantRegion}:`);
            if (best) return best;
        }

        // 4. Prefer any new bridge.
        const bestNew = selectBestFrom(newBridgeCandidates, "Selected new bridge (general fallback):");
        if (bestNew) return bestNew;

        // 5. Fallback if participantRegion was pinned but no regional bridge was found
        if (participantRegion && this.config.getOptionalConfig('bridge.participantRegionPinned', false) &&
            !this.config.getOptionalConfig('bridge.allowSelectionIfNoRegionalMatch', true)) {
            // If region is pinned AND we are not allowed to select non-regional, and we got here, it means no regional bridge was found.
            this.logger.warn(`Participant region ${participantRegion} is pinned, but no suitable bridge found in region. And not allowed to select non-regional.`);
            return null;
        }
        // If participantRegionPinned is false, or allowSelectionIfNoRegionalMatch is true,
        // the previous steps would have selected a non-regional bridge if available.
        // If we are here, it means no bridge met any criteria.

        this.logger.warn('No suitable bridge found after applying all selection criteria.');
        return null;
    }

    /**
     * Updates the statistics for a known bridge.
     * @param {string} bridgeJid - The JID of the bridge to update.
     * @param {object} stats - The new stats object (e.g., { stress, participantCount }).
     */
    updateBridgeStats(bridgeJid, stats) {
        const bridge = this.availableBridges.get(bridgeJid);
        if (bridge) {
            bridge.updateStats(stats);
        } else {
            this.logger.warn(`Attempted to update stats for unknown bridge: ${bridgeJid}`);
        }
    }

    /**
     * Handles notification that a bridge is down or no longer available.
     * @param {string} bridgeJid - The JID of the bridge that went down.
     */
    bridgeDown(bridgeJid) {
        const b = this.availableBridges.get(bridgeJid);
        if (b) {
            b.setIsOperational(false);
            this.logger.info(`Bridge ${bridgeJid} marked as NOT operational.`);
        } else {
            this.logger.warn(`bridgeDown event for unknown bridge: ${bridgeJid}`);
        }
    }

    /**
     * Handles notification that a bridge is up or has become available.
     * @param {Bridge} bridgeInfo - An object containing bridge info, typically a new Bridge instance or data to create one.
     */
    bridgeUp(bridgeInfo) { // bridgeInfo could be a Bridge instance or data to construct one
        let bridge = this.availableBridges.get(bridgeInfo.getJid());
        if (bridge) {
            bridge.setIsOperational(true);
            bridge.setIsInGracefulShutdown(false);
            // Update other properties if bridgeInfo contains more recent data
            if (bridgeInfo.version) bridge.setVersion(bridgeInfo.version);
            if (bridgeInfo.region) bridge.setRegion(bridgeInfo.region);
            if (bridgeInfo.relayId) bridge.setRelayId(bridgeInfo.relayId);
            this.logger.info(`Bridge ${bridge.getJid()} marked as OPERATIONAL and updated.`);
        } else {
            // If it's a completely new bridge, add it.
            // Assumes bridgeInfo is a Bridge instance if not found.
            // If bridgeInfo is just data, we'd do: new Bridge(bridgeInfo.jid, ...)
            this.addBridge(bridgeInfo);
            this.logger.info(`New bridge ${bridgeInfo.getJid()} came up and was added.`);
        }
    }

    /**
     * Handles notification that a bridge has entered graceful shutdown.
     * @param {string} bridgeJid - The JID of the bridge.
     */
    bridgeGracefulShutdown(bridgeJid) {
        const b = this.availableBridges.get(bridgeJid);
        if (b) {
            b.setIsInGracefulShutdown(true);
            this.logger.info(`Bridge ${bridgeJid} marked as in GRACEFUL SHUTDOWN.`);
        } else {
            this.logger.warn(`bridgeGracefulShutdown event for unknown bridge: ${bridgeJid}`);
        }
    }

    // TODO: Implement more sophisticated selection strategies as separate classes/functions.
}

module.exports = BridgeSelector;
