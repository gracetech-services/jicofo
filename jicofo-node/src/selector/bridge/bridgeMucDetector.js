const loggerModule = require('../../utils/logger');
const { ChatRoom } = require('../../xmpp/muc/chatRoom'); // Path to ChatRoom class
const Bridge = require('./bridge'); // Path to Bridge class
const { JidUtils } = require('../../config/serviceConfigs');

// Common namespaces and element names for JVB presence extensions
const NS_JVB_PRESENCE = 'http://jitsi.org/protocol/jitsi-videobridge'; // For version, graceful-shutdown, stress
const NS_COLIBRI_STATS = 'http://jitsi.org/protocol/colibri'; // Sometimes stats are here too
const NS_JITSI_MEET_PRESENCE = 'http://jitsi.org/jitmeet'; // For region, stats-id often under this
const NS_OCTO = 'urn:xmpp:octo:1'; // For Octo relay ID

class BridgeMucDetector {
    /**
     * @param {ManagedXmppConnection} xmppConnection - The XMPP connection to use for MUC.
     * @param {BridgeSelector} bridgeSelector - The BridgeSelector instance to update.
     * @param {string} breweryMucJid - The JID of the JVB brewery MUC.
     * @param {string} focusMucNickname - The nickname Jicofo should use in the brewery MUC.
     * @param {object} jicofoSrv - Jicofo services for config access.
     * @param {class} [ChatRoomClass=ChatRoom] - The ChatRoom class to use (for testing).
     */
    constructor(xmppConnection, bridgeSelector, breweryMucJid, focusMucNickname, jicofoSrv, ChatRoomClass = ChatRoom) {
        this.xmppConnection = xmppConnection;
        this.bridgeSelector = bridgeSelector;
        this.breweryMucJid = JidUtils.entityBareFrom(breweryMucJid);
        this.focusMucNickname = focusMucNickname || 'jicofo-detector';
        this.jicofoSrv = jicofoSrv; // For config if needed for parsing hints
        this.ChatRoomClass = ChatRoomClass; // Store the ChatRoom class for use in start()

        this.logger = loggerModule.child({ component: 'BridgeMucDetector', muc: this.breweryMucJid });

        this.chatRoom = null;
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) {
            this.logger.warn('Already started.');
            return;
        }
        if (!this.breweryMucJid) {
            this.logger.error('Brewery MUC JID not configured. BridgeMucDetector cannot start.');
            return;
        }

        this.logger.info(`Starting and joining brewery MUC: ${this.breweryMucJid}`);
        this.chatRoom = new this.ChatRoomClass(
            this.breweryMucJid,
            this.xmppConnection,
            this.focusMucNickname,
            this.logger
        );

        try {
            await this.chatRoom.join();
            this._setupMucListeners();
            this.isRunning = true;
            this.logger.info(`Successfully joined brewery MUC: ${this.breweryMucJid}`);
        } catch (error) {
            this.logger.error(`Failed to join brewery MUC ${this.breweryMucJid}:`, error);
            this.chatRoom = null; // Clear chatRoom if join failed
        }
    }

    async stop() {
        if (!this.isRunning || !this.chatRoom) {
            this.logger.warn('Not running or no chatRoom, cannot stop.');
            return;
        }
        this.logger.info(`Stopping and leaving brewery MUC: ${this.breweryMucJid}`);
        this.isRunning = false;
        this._removeMucListeners(); // Important to remove before leave, to avoid processing own unavailable
        try {
            await this.chatRoom.leave('Shutting down detector');
        } catch (error) {
            this.logger.error(`Error leaving brewery MUC ${this.breweryMucJid}:`, error);
        }
        this.chatRoom = null;
    }

    _setupMucListeners() {
        if (!this.chatRoom) return;
        // Note: ChatRoomMember objects are created/updated by ChatRoom itself based on presence.
        // We get these ChatRoomMember objects which should have parsed some basic info.
        this.chatRoom.on('memberPresenceChanged', this._handleMucPresence.bind(this));
        this.chatRoom.on('memberJoined', this._handleMucPresence.bind(this)); // memberJoined also provides presence
        this.chatRoom.on('memberLeft', this._handleMucMemberLeft.bind(this));
    }

    _removeMucListeners() {
        if (!this.chatRoom) return;
        this.chatRoom.removeAllListeners('memberPresenceChanged');
        this.chatRoom.removeAllListeners('memberJoined');
        this.chatRoom.removeAllListeners('memberLeft');
    }

    /**
     * Handles presence from a MUC member (potential JVB).
     * @param {ChatRoomMember} chatRoomMember - The member whose presence was received/updated.
     * @param {Element} presenceStanza - The raw presence stanza.
     */
    _handleMucPresence(chatRoomMember, presenceStanza) {
        const memberFullJid = chatRoomMember.getOccupantJid(); // This is room@service/resource (e.g., brewery@example.com/jvb1.example.com)
        const bridgeJidString = JidUtils.getResourcePart(memberFullJid); // The resource part is expected to be the JVB's component JID

        if (!bridgeJidString) {
            this.logger.debug(`Could not extract bridge JID from MUC occupant ${memberFullJid}. Ignoring presence.`);
            return;
        }

        // Validate if bridgeJidString is a valid JID itself (optional, but good practice)
        // const parsedBridgeJid = JidUtils.parse(bridgeJidString);
        // if (!parsedBridgeJid) {
        //     this.logger.warn(`Occupant resource '${bridgeJidString}' from ${memberFullJid} is not a valid JID. Ignoring.`);
        //     return;
        // }
        // For now, assume resource part is the JID string we need.
        // The bridgeComponentJid for map keys and Bridge object should be this resource part.

        if (bridgeJidString === this.xmppConnection.xmpp.jid.getResource()) { // Check if it's self via resource on same connection
            // This check might be too simplistic if focus joins MUC with a different resource.
            // A better check is if bridgeJidString matches one of Jicofo's known service JIDs.
            // For now, assuming Jicofo's resource in the brewery MUC is distinct from JVB JIDs.
            return;
        }

        // Simplistic check: Does it look like a JVB?
        // Real JVBs advertise features like 'urn:xmpp:rayo:0' or specific Colibri features.
        // For now, we'll parse common JVB stats if present.
        // A more robust check for JVB identity would be to look for specific features in <c/> node
        // or a specific disco#info identity.
        // For this iteration, we assume any presence with JVB-like stats is a JVB.

        this.logger.debug(`Processing presence from ${memberFullJid} (JVB JID: ${bridgeJidString}) in ${this.breweryMucJid}`);

        // Primary JVB identification element
        const jvbElement = presenceStanza.getChild('jitsi-videobridge', NS_JVB_PRESENCE);
        if (!jvbElement) {
            this.logger.debug(`Presence from ${memberFullJid} is missing top-level <jitsi-videobridge> element. Still attempting to parse other stats.`);
        }

        let bridge = this.bridgeSelector.availableBridges.get(bridgeJidString);
        let isNewBridge = false;
        if (!bridge) {
            this.logger.info(`New JVB discovered in brewery: ${bridgeJidString}`);
            bridge = new Bridge(bridgeJidString);
            isNewBridge = true;
        }

        // --- Parse JVB specific presence extensions ---
        const version = jvbElement?.attrs.version;

        const regionEl = presenceStanza.getChild('region', NS_JITSI_MEET_PRESENCE);
        const region = regionEl ? regionEl.getText() : null;

        let stress = null;
        const stressLevelEl = presenceStanza.getChild('stress-level', NS_JVB_PRESENCE);
        if (stressLevelEl) {
            const stressVal = parseFloat(stressLevelEl.getText());
            if (!isNaN(stressVal)) stress = stressVal;
        } else {
            const colibriStatsEl = presenceStanza.getChild('stats', NS_COLIBRI_STATS);
            const stressElFromStats = colibriStatsEl?.getChild('stress');
            if (stressElFromStats) {
                const stressVal = parseFloat(stressElFromStats.getText());
                if (!isNaN(stressVal)) stress = stressVal;
            }
        }

        const relayEl = presenceStanza.getChild('relay', NS_OCTO);
        const relayId = relayEl ? relayEl.attrs.id : null;

        const gracefulShutdownEl = presenceStanza.getChild('graceful-shutdown', NS_JVB_PRESENCE);
        const isInGracefulShutdown = !!gracefulShutdownEl;

        const statsIdEl = presenceStanza.getChild('stats-id', NS_JITSI_MEET_PRESENCE);
        const statsId = statsIdEl ? statsIdEl.getText() : null;

        this.logger.info(
            `Updating JVB Data for ${bridgeJidString}: version=${version || 'N/A'}, region=${region || 'N/A'}, ` +
            `stress=${stress === null ? 'N/A' : stress.toFixed(2)}, relayId=${relayId || 'N/A'}, gracefulShutdown=${isInGracefulShutdown}, statsId=${statsId || 'N/A'}`
        );

        // Update Bridge object - setters on Bridge should handle null/undefined gracefully
        bridge.setVersion(version);
        bridge.setRegion(region);
        bridge.setRelayId(relayId);
        bridge.updateStats({ stress: stress }); // updateStats handles parsing/clamping
        bridge.setIsInGracefulShutdown(isInGracefulShutdown);
        bridge.setIsOperational(true); // If we get presence, assume it's operational unless in graceful shutdown

        if (isNewBridge) {
            this.bridgeSelector.addBridge(bridge);
        } else {
            // For existing bridges, ensure selector is aware of potential status changes
            // addBridge also handles updates if bridge already exists.
            this.bridgeSelector.addBridge(bridge);
            // Or more granularly:
            // this.bridgeSelector.updateBridgeStats(bridge.getJid(), { stress });
            // if (isInGracefulShutdown) this.bridgeSelector.bridgeGracefulShutdown(bridge.getJid());
            // else this.bridgeSelector.bridgeUp(bridge); // Confirms it's up
        }
    }

    /**
     * Handles a member leaving the brewery MUC.
     * @param {ChatRoomMember} chatRoomMember - The member who left.
     * @param {Element} presenceStanza - The unavailable presence stanza.
     */
    _handleMucMemberLeft(chatRoomMember, presenceStanza) {
        const memberFullJid = chatRoomMember.getOccupantJid();
        const bridgeJidString = JidUtils.getResourcePart(memberFullJid);

        if (!bridgeJidString) {
            this.logger.debug(`Could not extract bridge JID from left MUC occupant ${memberFullJid}. Ignoring leave event.`);
            return;
        }

        this.logger.info(`Member left brewery MUC: ${memberFullJid} (JVB JID: ${bridgeJidString}). Assuming bridge is down or removed.`);
        const bridge = this.bridgeSelector.availableBridges.get(bridgeJidString);
        if (bridge) {
            this.bridgeSelector.bridgeDown(bridgeJidString);
            // Optionally, could also remove it if brewery MUC leave implies permanent removal
            // this.bridgeSelector.removeBridge(bridge);
        } else {
            this.logger.warn(`Bridge ${bridgeJidString} (from ${memberFullJid}) left MUC but was not in availableBridges map.`);
        }
    }
}

module.exports = BridgeMucDetector;
