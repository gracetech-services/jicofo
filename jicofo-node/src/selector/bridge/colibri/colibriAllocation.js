// Represents the result of a successful Colibri allocation for a participant.
// Based on the return type of ColibriV2SessionManager.handleResponse

/**
 * @typedef {object} ColibriAllocation
 * @property {ConferenceSourceMap} feedbackSources - The feedback sources (e.g., for RTCP termination) from the bridge.
 * @property {object} iceUdpTransport - The ICE/UDP transport details from the bridge (parsed from IceUdpTransportPacketExtension).
 * @property {string|null} region - The region of the bridge that handled the allocation.
 * @property {string} bridgeSessionId - The Colibri conference ID on the bridge.
 * @property {number|null} sctpPort - The SCTP port if a data channel was allocated.
 */

class ColibriAllocation {
    /**
     * @param {ConferenceSourceMap} feedbackSources
     * @param {object} iceUdpTransport - Parsed transport object.
     * @param {string|null} region
     * @param {string} bridgeSessionId - This is the Colibri conference ID.
     * @param {number|null} sctpPort
     */
    constructor(feedbackSources, iceUdpTransport, region, bridgeSessionId, sctpPort) {
        this.feedbackSources = feedbackSources; // Instance of our ConferenceSourceMap
        this.iceUdpTransport = iceUdpTransport; // Plain object representing parsed transport
        this.region = region;
        this.bridgeSessionId = bridgeSessionId; // This is the <conference id="..."> from colibri2
        this.sctpPort = sctpPort;
    }
}

// Exceptions related to Colibri allocations
class ColibriAllocationFailedException extends Error {
    constructor(message, removeBridge = false) {
        super(message);
        this.name = "ColibriAllocationFailedException";
        this.removeBridge = removeBridge; // Whether the bridge should be marked as non-operational/removed from conference
    }
}

class BridgeSelectionFailedException extends Error {
    constructor(message = "Bridge selection failed.") {
        super(message);
        this.name = "BridgeSelectionFailedException";
    }
}

class ConferenceAlreadyExistsException extends ColibriAllocationFailedException {
    constructor(message, removeBridge = false) {
        super(message, removeBridge);
        this.name = "ConferenceAlreadyExistsException";
    }
}


module.exports = {
    ColibriAllocation,
    ColibriAllocationFailedException,
    BridgeSelectionFailedException,
    ConferenceAlreadyExistsException
};
