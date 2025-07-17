const logger = require('../utils/logger');
const { VisitorsConfig } = require('../visitors/visitorsConfig');

/**
 * Conference utility functions
 */
class ConferenceUtil {
    /**
     * Convert a ContentPacketExtension to Media
     * @param {Object} contentPacketExtension - The content packet extension
     * @returns {Object|null} - The media object or null
     */
    static toMedia(contentPacketExtension) {
        const media = {};
        
        const mediaType = contentPacketExtension.name?.toLowerCase();
        if (mediaType === 'audio') {
            media.type = 'AUDIO';
        } else if (mediaType === 'video') {
            media.type = 'VIDEO';
        } else {
            return null;
        }

        // Extract RTP description if available
        const rtpDescription = contentPacketExtension.getFirstChildOfType?.('RtpDescriptionPacketExtension');
        if (rtpDescription) {
            media.payloadTypes = rtpDescription.payloadTypes || [];
            media.rtpHdrExts = rtpDescription.extmapList || [];
            media.extmapAllowMixed = rtpDescription.extmapAllowMixed;
        }

        return media;
    }

    /**
     * Get transport from a list of content packet extensions
     * @param {Array} contentPacketExtensions - List of content packet extensions
     * @returns {Object|null} - The transport object or null
     */
    static getTransport(contentPacketExtensions) {
        const transport = contentPacketExtensions.find(ext => 
            ext.getFirstChildOfType?.('IceUdpTransportPacketExtension')
        )?.getFirstChildOfType('IceUdpTransportPacketExtension');

        if (!transport) {
            return null;
        }

        // Insert rtcp-mux if missing
        if (!transport.isRtcpMux) {
            transport.addChildExtension({ type: 'IceRtcpmuxPacketExtension' });
        }

        return transport;
    }

    /**
     * Select a visitor node based on existing nodes and all available nodes
     * @param {Map} existingNodes - Map of existing nodes with their chat rooms
     * @param {Array} allNodes - List of all available XMPP providers
     * @returns {string|null} - The selected node name or null
     */
    static selectVisitorNode(existingNodes, allNodes) {
        // Find the node with minimum visitor count
        let minNode = null;
        let minVisitorCount = Infinity;

        for (const [nodeName, chatRoom] of existingNodes) {
            if (chatRoom.visitorCount < minVisitorCount) {
                minVisitorCount = chatRoom.visitorCount;
                minNode = nodeName;
            }
        }

        // If we found a node and it's under the limit, use it
        if (minNode && minVisitorCount < VisitorsConfig.config.maxVisitorsPerNode) {
            return minNode;
        }

        // Find a registered node that's not already in use
        const availableNodes = allNodes.filter(node => 
            !existingNodes.has(node.config.name) && node.registered
        );

        if (availableNodes.length > 0) {
            // Return a random available node
            const randomIndex = Math.floor(Math.random() * availableNodes.length);
            return availableNodes[randomIndex].config.name;
        }

        // Fallback to any random node
        if (allNodes.length > 0) {
            const randomIndex = Math.floor(Math.random() * allNodes.length);
            return allNodes[randomIndex].config.name;
        }

        return null;
    }

    /**
     * Get the JID of the visitor MUC for a given main room
     * @param {string} mainRoom - The main room JID
     * @param {Object} mainXmppProvider - The main XMPP provider
     * @param {Object} visitorXmppProvider - The visitor XMPP provider
     * @returns {string} - The visitor MUC JID
     */
    static getVisitorMucJid(mainRoom, mainXmppProvider, visitorXmppProvider) {
        const mainDomain = mainXmppProvider.config.xmppDomain;
        if (!mainDomain) {
            throw new Error('Main domain not configured');
        }

        const visitorDomain = visitorXmppProvider.config.xmppDomain;
        if (!visitorDomain) {
            throw new Error(`Visitor domain not configured for ${visitorXmppProvider.config.name}`);
        }

        // Replace the main domain with the visitor domain in the room JID
        return mainRoom.toString().replace(mainDomain, visitorDomain);
    }

    /**
     * Generate a unique conference ID
     * @returns {string} - A unique conference ID
     */
    static generateConferenceId() {
        return `conf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Validate a conference room name
     * @param {string} roomName - The room name to validate
     * @returns {boolean} - True if valid, false otherwise
     */
    static isValidRoomName(roomName) {
        if (!roomName || typeof roomName !== 'string') {
            return false;
        }

        // Basic validation - room name should not be empty and should be reasonable length
        if (roomName.trim().length === 0 || roomName.length > 255) {
            return false;
        }

        // Check for invalid characters (basic check)
        const invalidChars = /[<>:"\\|?*]/;
        if (invalidChars.test(roomName)) {
            return false;
        }

        return true;
    }

    /**
     * Parse conference properties from a request
     * @param {Object} request - The conference request object
     * @returns {Object} - Parsed conference properties
     */
    static parseConferenceProperties(request) {
        const properties = {};

        if (request.properties) {
            // Copy basic properties
            Object.assign(properties, request.properties);

            // Handle specific property types
            if (request.properties.visitors) {
                properties.visitors = {
                    enabled: request.properties.visitors.enabled || false,
                    maxParticipants: request.properties.visitors.maxParticipants || 100
                };
            }

            if (request.properties.recording) {
                properties.recording = {
                    enabled: request.properties.recording.enabled || false,
                    mode: request.properties.recording.mode || 'file'
                };
            }
        }

        return properties;
    }
}

module.exports = ConferenceUtil; 