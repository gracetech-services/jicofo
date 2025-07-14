const xmpp = require('node-xmpp-client');

class AvModeration {
    constructor(conference, xmppClient, logger) {
        this.conference = conference;
        this.xmppClient = xmppClient;
        this.logger = logger;
    }

    start() {
        this.xmppClient.on('stanza', (stanza) => {
            if (stanza.is('message') && stanza.getChild('json-message', 'http://jitsi.org/jitmeet')) {
                const jsonMessage = stanza.getChild('json-message', 'http://jitsi.org/jitmeet');
                try {
                    const payload = JSON.parse(jsonMessage.getText());
                    if (payload.type === 'av_moderation') {
                        this.handleAvModerationCommand(payload);
                    }
                } catch (e) {
                    this.logger.error('Error parsing json-message', e);
                }
            }
        });
    }

    handleAvModerationCommand(payload) {
        const { room, enabled, mediaType, actor } = payload;
        if (room !== this.conference.roomName) {
            return;
        }
        this.logger.info(`Received av_moderation command: ${JSON.stringify(payload)}`);

        if (enabled) {
            this.conference.participants.forEach((participant, id) => {
                // Don't mute the actor
                if (id !== actor) {
                    this.mute(id, mediaType);
                }
            });
        }
    }

    mute(participantId, mediaType) {
        this.logger.info(`Muting ${participantId} for ${mediaType}`);
        const iq = new xmpp.Stanza('iq', {
            type: 'set',
            to: this.conference.participants.get(participantId).jid,
            from: this.xmppClient.jid,
            id: `mute-${Date.now()}`,
        });
        if (mediaType === 'audio') {
            iq.c('mute', { xmlns: 'http://jitsi.org/jitmeet/audio' }).t('true');
        } else if (mediaType === 'video') {
            iq.c('mute', { xmlns: 'http://jitsi.org/jitmeet/video' }).t('true');
        }
        this.xmppClient.send(iq);
    }
}

module.exports = AvModeration;
