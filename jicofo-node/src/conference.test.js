const Conference = require('./conference');

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

describe('Conference', () => {
    let conference;
    let xmppClient;
    let logger;

    beforeEach(() => {
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
        conference = new Conference('test-room@example.com', xmppClient, logger);
    });

    it('should start and join the room', () => {
        conference.start();
        expect(conference.started).toBe(true);
        expect(xmppClient.send).toHaveBeenCalledWith('presence', {
            to: 'test-room@example.com/test-user',
            from: xmppClient.jid,
        });
    });

    it('should stop and leave the room', () => {
        conference.start();
        conference.stop();
        expect(conference.started).toBe(false);
        expect(xmppClient.send).toHaveBeenCalledWith('presence', {
            to: 'test-room@example.com/test-user',
            from: xmppClient.jid,
            type: 'unavailable',
        });
    });
});
