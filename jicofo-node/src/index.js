const xmpp = require('node-xmpp-client');
const Conference = require('./conference');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple(),
        })
    ],
});

class FocusManager {
    constructor(xmppClient, logger) {
        this.xmppClient = xmppClient;
        this.logger = logger;
        this.conferences = new Map();
    }

    createConference(roomName) {
        if (this.conferences.has(roomName)) {
            return this.conferences.get(roomName);
        }
        const conference = new Conference(roomName, this.xmppClient, this.logger);
        this.conferences.set(roomName, conference);
        conference.start();
        return conference;
    }
}

// Example usage:
// const client = new xmpp.Client({
//     host: 'your-xmpp-server.com',
//     port: 5222,
//     jid: 'your-jid@your-xmpp-server.com',
//     password: 'your-password',
// });
//
// const focusManager = new FocusManager(client, logger);
//
// client.on('online', () => {
//     logger.info('XMPP client is online');
//     focusManager.createConference('your-conference@your-muc-service.com');
// });
//
// client.on('error', (e) => {
//     logger.error(e);
// });
//
// client.connect();

module.exports = FocusManager;
