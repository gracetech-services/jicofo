const { v4: uuidv4 } = require('uuid');
const AvModeration = require('./avModeration');

class Conference {
    constructor(roomName, xmppClient, logger) {
        this.roomName = roomName;
        this.xmppClient = xmppClient;
        this.logger = logger;
        this.participants = new Map();
        this.meetingId = uuidv4();
        this.started = false;
        this.singleParticipantTimeout = null;
        this.avModeration = new AvModeration(this, xmppClient, logger);
    }

    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        this.logger.info(`Starting conference ${this.roomName}`);
        this.joinRoom();
        this.avModeration.start();
    }

    stop() {
        if (!this.started) {
            return;
        }
        this.started = false;
        this.logger.info(`Stopping conference ${this.roomName}`);
        this.leaveRoom();
        this.clearSingleParticipantTimeout();
    }

    joinRoom() {
        const presence = {
            to: `${this.roomName}/${this.xmppClient.jid.local}`,
            from: this.xmppClient.jid,
        };
        this.xmppClient.send('presence', presence);
        this.xmppClient.on('stanza', (stanza) => {
            if (stanza.is('presence') && stanza.attrs.from.bare === this.roomName) {
                const from = stanza.attrs.from;
                const participantId = from.resource;
                if (stanza.attrs.type === 'unavailable') {
                    this.handleParticipantLeft(participantId);
                } else {
                    this.handleParticipantJoined(participantId, from);
                }
            }
        });
    }

    leaveRoom() {
        const presence = {
            to: `${this.roomName}/${this.xmppClient.jid.local}`,
            from: this.xmppClient.jid,
            type: 'unavailable',
        };
        this.xmppClient.send('presence', presence);
    }

    handleParticipantJoined(participantId, from) {
        if (!this.participants.has(participantId)) {
            this.logger.info(`Participant joined: ${participantId}`);
            this.participants.set(participantId, { jid: from });
            this.clearSingleParticipantTimeout();
        }
    }

    handleParticipantLeft(participantId) {
        if (this.participants.has(participantId)) {
            this.logger.info(`Participant left: ${participantId}`);
            this.participants.delete(participantId);
            if (this.participants.size === 1) {
                this.scheduleSingleParticipantTimeout();
            } else if (this.participants.size === 0) {
                this.stop();
            }
        }
    }

    scheduleSingleParticipantTimeout() {
        if (this.singleParticipantTimeout) {
            return;
        }
        this.logger.info('Scheduling single participant timeout');
        this.singleParticipantTimeout = setTimeout(() => {
            this.logger.info('Single participant timeout expired');
            this.stop();
        }, 60000); // 1 minute
    }

    clearSingleParticipantTimeout() {
        if (this.singleParticipantTimeout) {
            this.logger.info('Clearing single participant timeout');
            clearTimeout(this.singleParticipantTimeout);
            this.singleParticipantTimeout = null;
        }
    }
}

module.exports = Conference;
