const EventEmitter = require('events');
const loggerModule = require('../../utils/logger');
const { JidUtils } = require('../../config/serviceConfigs');

const { Features, createFeatureSet } = require('../features'); // Import Features

// Represents a chat room member
class ChatRoomMember {
    constructor(mucJid, chatRoom, initialPresenceStanza) {
        this.mucJid = mucJid; // Full MUC JID: room@conference.server/nickname
        this.nick = JidUtils.getResourcePart(mucJid);
        this.chatRoom = chatRoom;

        this.presence = null;
        this.role = null;
        this.affiliation = null;
        this.features = new Set(); // Set of feature strings (e.g., from Features enum)

        this.isJibri = false;
        this.isJigasi = false;
        this.isTranscriber = false; // Typically a type of Jigasi

        this.statsId = null;
        this.region = null;
        this.audioMuted = true; // Default to muted until presence indicates otherwise
        this.videoMuted = true; // Default to muted
        this.videoType = null; // e.g., 'camera', 'desktop' from <videoType> extension

        if (initialPresenceStanza) {
            this.updatePresence(initialPresenceStanza);
        }
    }

    getOccupantJid() {
        return this.mucJid;
    }

    getName() { // This is the MUC nickname
        return this.nick;
    }

    updatePresence(presenceStanza) {
        this.presence = presenceStanza;

        // Standard MUC user info
        const mucUserElement = presenceStanza.getChild('x', 'http://jabber.org/protocol/muc#user');
        if (mucUserElement) {
            const itemElement = mucUserElement.getChild('item');
            if (itemElement) {
                this.role = itemElement.attrs.role;
                this.affiliation = itemElement.attrs.affiliation;
            }
        }

        // Jitsi Meet specific presence extensions
        // Namespace for stats-id: 'http://jitsi.org/jitmeet/stats'
        // Namespace for region: 'http://jitsi.org/jitsimeet' (seems to be the one used in Jitsi Meet client)
        // Namespace for audio/videomuted: 'http://jitsi.org/jitmeet/audio' and 'http://jitsi.org/jitmeet/video'
        // Namespace for videoType: 'http://jitsi.org/jitmeet/video'

        const statsIdEl = presenceStanza.getChild('stats-id', 'http://jitsi.org/jitmeet/stats');
        if (statsIdEl) this.statsId = statsIdEl.getText();

        const regionEl = presenceStanza.getChild('region', 'http://jitsi.org/jitsimeet');
        if (regionEl) this.region = regionEl.getText();

        const audioMutedEl = presenceStanza.getChild('audiomuted', 'http://jitsi.org/jitmeet/audio');
        // Default to true if element not present or not 'false' explicitly
        this.audioMuted = audioMutedEl ? audioMutedEl.getText() === 'true' : true;


        const videoMutedEl = presenceStanza.getChild('videomuted', 'http://jitsi.org/jitmeet/video');
        this.videoMuted = videoMutedEl ? videoMutedEl.getText() === 'true' : true;

        const videoTypeEl = presenceStanza.getChild('videoType', 'http://jitsi.org/jitmeet/video');
        if (videoTypeEl) this.videoType = parseVideoType(videoTypeEl.getText()); else this.videoType = VideoType.NONE;


        // Features from Caps
        const capsElement = presenceStanza.getChild('c', 'http://jabber.org/protocol/caps');
        if (capsElement && capsElement.attrs.node && capsElement.attrs.ver) {
            // In a real system, we'd use the node+ver to query disco#info if features aren't cached.
            // For now, we'll assume if caps is present, they support default Jitsi features.
            // A more robust solution would involve a CapsCache and disco.
            // this.features = this.chatRoom.xmppConnection.getCachedFeatures(capsElement.attrs.node, capsElement.attrs.ver);
            // If not cached, this might trigger a disco#info query.
            // For now, let's add some default features if caps is present as a placeholder.
            if (!this.features || this.features.size === 0) { // Only if not already populated by disco
                 Features.defaultFeatures.forEach(f => this.features.add(f));
            }
        }

        // Check for Jibri/Jigasi based on features or specific presence elements
        // This is a simplified check; Jitsi Meet often uses specific feature nodes or sub-protocols.
        // Example: Jibri might have a specific <jibri-status> element or a feature.
        // For now, let's assume a feature string might indicate this.
        if (this.features.has('http://jitsi.org/protocol/jibri')) { // Example feature
            this.isJibri = true;
        }
        // Jigasi might also have a feature like 'urn:xmpp:jingle:apps:rtp:audio' but also specific jigasi feature.
        // Transcriber is often a Jigasi with a specific 'transcribing' status or context.
        const jigasiElement = presenceStanza.getChild('jigasi', 'http://jitsi.org/protocol/jigasi');
        if (jigasiElement) {
            this.isJigasi = true;
            if (jigasiElement.attrs.status === 'transcribing') { // Example attribute
                this.isTranscriber = true;
            }
        }

        // TODO: Parse other extensions like <nick>, <identity>, etc. for more complete profile.
    }
}


class ChatRoom extends EventEmitter {
    /**
     * @param {string} roomJid - Bare JID of the MUC room.
     * @param {ManagedXmppConnection} xmppConnection - The XMPP connection to use.
     * @param {string} nickname - Nickname for the focus user in this MUC.
     * @param {Logger} parentLogger - Parent logger instance.
     */
    constructor(roomJid, xmppConnection, nickname, parentLogger) {
        super();
        this.roomJid = JidUtils.entityBareFrom(roomJid); // Ensure it's bare
        this.xmppConnection = xmppConnection;
        this.nickname = nickname;
        this.logger = parentLogger.child({ muc: this.roomJid });

        this.members = new Map(); // Nickname -> ChatRoomMember
        this.joined = false;
        this.presenceHandler = null; // To store the function for removing the listener
        this.messageHandler = null; // To store the function for removing the listener

        this.meetingId = null;
        this.mainRoomJid = null; // If this is a breakout room
        this.focusMucJid = `${this.roomJid}/${this.nickname}`;
    }

    getNick() {
        return this.nickname;
    }

    getRoomJid() {
        return this.roomJid;
    }

    async join() {
        if (this.joined) {
            this.logger.warn('Already joined MUC.');
            return { meetingId: this.meetingId, mainRoomJid: this.mainRoomJid };
        }

        this.logger.info(`Joining MUC ${this.roomJid} as ${this.nickname}`);
        try {
            await this.xmppConnection.joinMuc(this.roomJid, this.nickname);
            this.joined = true;
            this._setupMucListeners();
            this.logger.info(`Successfully sent join presence to MUC ${this.roomJid}. Waiting for self-presence.`);

            // TODO: Fetch MUC configuration (disco#info, MUC unique ID from config form)
            // For now, we'll assume meetingId might come from elsewhere or be generated.
            // In Jitsi Meet, the meetingId (aka MUC unique name) is often fetched via disco#info on the MUC
            // and looking for a field like 'muc#roomconfig_roomname' or a specific unique ID field.
            // Or it's derived from the room name if not found.
            // mainRoomJid would also be discovered via MUC config or specific presence extensions.

            // Simulate fetching/setting meetingId for now
            if (!this.meetingId) this.meetingId = require('crypto').randomUUID();

            return { meetingId: this.meetingId, mainRoomJid: this.mainRoomJid };
        } catch (error) {
            this.logger.error('Failed to join MUC:', error);
            this.joined = false; // Ensure joined is false on error
            throw error;
        }
    }

    async leave(statusMessage) {
        if (!this.joined) {
            this.logger.warn('Not joined to MUC, cannot leave.');
            return;
        }
        this.logger.info(`Leaving MUC ${this.roomJid}`);
        this._removeMucListeners();
        try {
            await this.xmppConnection.leaveMuc(this.roomJid, this.nickname, statusMessage);
            this.joined = false;
            this.members.clear();
        } catch (error) {
            this.logger.error('Error leaving MUC:', error);
            // Even on error, mark as not joined as the intention was to leave
            this.joined = false;
        }
    }

    async sendMessage(body, type = 'groupchat') {
        if (!this.joined) {
            this.logger.warn('Cannot send message, not joined to MUC.');
            return;
        }
        await this.xmppConnection.sendMucMessage(this.roomJid, body, type);
    }

    _setupMucListeners() {
        // Listener for all presence stanzas coming from the MUC
        this.presenceHandler = this.xmppConnection.addPresenceListener((stanza) => {
            // Ensure presence is from this MUC room (bare JID match)
            const fromJid = JidUtils.parse(stanza.attrs.from);
            if (!fromJid || !JidUtils.bareEq(fromJid, this.roomJid)) {
                return; // Not from this MUC
            }

            const memberNick = fromJid.resource; // Nickname from resource part
            if (!memberNick) return;

            const isSelf = memberNick === this.nickname;
            const type = stanza.attrs.type;

            if (type === 'unavailable') {
                const existingMember = this.members.get(memberNick);
                if (existingMember) {
                    this.members.delete(memberNick);
                    this.logger.info(`Member left MUC: ${memberNick}`);
                    this.emit('memberLeft', existingMember, stanza);
                }
            } else { // Available or presence update
                let member = this.members.get(memberNick);
                if (!member) {
                    member = new ChatRoomMember(fromJid.toString(), this, stanza);
                    this.members.set(memberNick, member);
                    member.updatePresence(stanza); // Initial presence update
                    this.logger.info(`Member joined MUC: ${memberNick}`);
                    this.emit('memberJoined', member, stanza);

                    if (isSelf) {
                         this.logger.info(`Successfully joined MUC ${this.roomJid} as ${this.nickname}. Self-presence received.`);
                         this.emit('selfPresenceReceived', stanza);
                         // TODO: After self-presence, might fetch MUC config if not done yet.
                    }
                } else {
                    member.updatePresence(stanza);
                    this.logger.debug(`Presence update for MUC member: ${memberNick}`);
                    this.emit('memberPresenceChanged', member, stanza);
                }
            }
        });

        // TODO: Add message listener
        // this.messageHandler = this.xmppConnection.addMessageListener((stanza) => { ... });
        // Need addMessageListener in ManagedXmppConnection first
    }

    _removeMucListeners() {
        if (this.presenceHandler) {
            this.presenceHandler(); // This is the removal function returned by addPresenceListener
            this.presenceHandler = null;
        }
        if (this.messageHandler) {
            this.messageHandler();
            this.messageHandler = null;
        }
    }

    getMemberCount() {
        return this.members.size;
    }

    getMembers() {
        return Array.from(this.members.values());
    }

    getChatMember(fullMucJid) { // fullMucJid is string
        const nick = JidUtils.getResourcePart(fullMucJid);
        return nick ? this.members.get(nick) : null;
    }

    // TODO: Add methods for MUC configuration, presence updates, role/affiliation changes, etc.
    // async updatePresenceExtensions(extensions) { ... }
    // async grantOwnership() { ... }
    // getLobbyEnabled(), getVisitorsEnabled() - from MUC config
}

module.exports = { ChatRoom, ChatRoomMember };
