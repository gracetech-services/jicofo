const AvModeration = require('./avModeration');

describe('AvModeration', () => {
    let avModeration;
    let conference;
    let xmppClient;
    let logger;

    beforeEach(() => {
        conference = {
            roomName: 'test-room@example.com',
            participants: new Map([
                ['participant1', { jid: 'participant1@example.com' }],
                ['participant2', { jid: 'participant2@example.com' }],
            ]),
        };
        xmppClient = {
            send: jest.fn(),
            on: jest.fn(),
            jid: {
                local: 'test-user',
                bare: () => 'test-user@example.com'
            }
        };
        logger = {
            info: jest.fn(),
            error: jest.fn(),
        };
        avModeration = new AvModeration(conference, xmppClient, logger);
    });

    it('should mute all participants except the actor', () => {
        const payload = {
            type: 'av_moderation',
            room: 'test-room@example.com',
            enabled: true,
            mediaType: 'audio',
            actor: 'participant1',
        };
        avModeration.handleAvModerationCommand(payload);
        expect(xmppClient.send).toHaveBeenCalledTimes(1);
        expect(xmppClient.send).toHaveBeenCalledWith('iq', expect.objectContaining({
            to: 'participant2@example.com',
        }));
    });
});
