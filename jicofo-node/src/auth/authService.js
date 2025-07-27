const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
// Base class for authentication authorities
class AbstractAuthAuthority {
    constructor(enableAutoLogin, authenticationLifetime) {
        if (this.constructor === AbstractAuthAuthority) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        
        this.enableAutoLogin = enableAutoLogin;
        this.authenticationLifetime = authenticationLifetime;
        this.authenticationSessions = new Map();
        this.authenticationListeners = [];
        this.expireTimer = null;
        this.syncRoot = {};
        
        logger.info(`AbstractAuthAuthority initialized with autoLogin: ${enableAutoLogin}, lifetime: ${authenticationLifetime}ms`);
    }

    start() {
        logger.info('AbstractAuthAuthority starting...');
        // Start timer to check for session expiration
        this.expireTimer = setInterval(() => this._checkExpiredSessions(), 10000); // Check every 10seconds
    }

    shutdown() {
        logger.info('AbstractAuthAuthority shutting down...');
        if (this.expireTimer) {
            clearInterval(this.expireTimer);
            this.expireTimer = null;
        }
        this.authenticationSessions.clear();
        this.authenticationListeners = [];
    }

    addAuthenticationListener(listener) {
        this.authenticationListeners.push(listener);
    }

    removeAuthenticationListener(listener) {
        const index = this.authenticationListeners.indexOf(listener);
        if (index > -1) {
            this.authenticationListeners.splice(index,1);
        }
    }

    getSessionForJid(jabberId) {
        const session = this.findSession(s => 
            s.authenticatedJids && s.authenticatedJids.has(jabberId.toString())
        );
        return session ? session.sessionId : null;
    }

    getUserIdentity(jabberId) {
        const session = this.findSession(s => 
            s.authenticatedJids && s.authenticatedJids.has(jabberId.toString())
        );
        return session ? session.authIdentity : null;
    }

    destroySession(sessionId) {
        const session = this.authenticationSessions.get(sessionId);
        if (session) {
            this.authenticationSessions.delete(sessionId);
            logger.info(`Authentication session destroyed: ${sessionId}`);
        }
    }

    conferenceEnded(roomName) {
        if (!this.enableAutoLogin) {
            // Destroy sessions for this conference
            const sessionsToRemove = [];
            for (const [sessionId, session] of this.authenticationSessions) {
                if (session.roomName === roomName.toString()) {
                    sessionsToRemove.push(sessionId);
                }
            }
            sessionsToRemove.forEach(sessionId => this.destroySession(sessionId));
        }
    }

    processAuthentication(query, response) {
        // This is a simplified version - in real implementation would handle IQ packets
        const sessionId = query.sessionId;
        const session = this.getSession(sessionId);
        
        if (session) {
            // Verify existing session
            return this.verifySession(query);
        } else {
            // Process new authentication
            return this.processAuthLocked(query, response);
        }
    }

    processLogoutIq(iq) {
        const sessionId = iq.sessionId;
        if (sessionId) {
            this.destroySession(sessionId);
        }
        // Return success response
        return { type: 'result' };
    }

    // Protected methods to be implemented by subclasses
    processAuthLocked(query, response) {
        throw new Error('processAuthLocked must be implemented by subclass');
    }

    createLoginUrl(machineUID, peerFullJid, roomName, popup) {
        throw new Error('createLoginUrl must be implemented by subclass');
    }

    isExternal() {
        throw new Error('isExternal must be implemented by subclass');
    }

    createLogoutUrl(sessionId) {
        throw new Error('createLogoutUrl must be implemented by subclass');
    }

    // Helper methods
    findSession(selector) {
        for (const session of this.authenticationSessions.values()) {
            if (selector(session)) {
                return session;
            }
        }
        return null;
    }

    getSession(sessionId) {
        return this.authenticationSessions.get(sessionId);
    }

    createNewSession(machineUID, authIdentity, roomName) {
        const sessionId = this._createNonExistingUUID();
        const session = {
            machineUID,
            sessionId,
            authIdentity,
            roomName: roomName.toString(),
            authenticatedJids: new Set(),
            createdAt: Date.now()
        };
        
        this.authenticationSessions.set(sessionId, session);
        logger.info(`Authentication session created for ${authIdentity} SID: ${sessionId}`);
        
        return session;
    }

    verifySession(query) {
        const sessionId = query.sessionId;
        if (!sessionId) {
            return { type: 'error', error: 'Missing session ID' };
        }

        const session = this.getSession(sessionId);
        if (!session) {
            return { type: 'error', error: 'Invalid session' };
        }

        // Check if session has expired
        if (Date.now() - session.createdAt > this.authenticationLifetime) {
            this.destroySession(sessionId);
            return { type: 'error', error: 'Session expired' };
        }

        return null; // Session is valid
    }

    authenticateJidWithSession(session, peerJid, response) {
        session.authenticatedJids.add(peerJid.toString());
        this._notifyUserAuthenticated(peerJid, session.authIdentity, session.sessionId);
        
        if (response) {
            response.sessionId = session.sessionId;
            response.authenticated = true;
        }
    }

    _notifyUserAuthenticated(userJid, identity, sessionId) {
        this.authenticationListeners.forEach(listener => {
            try {
                if (typeof listener.userAuthenticated === 'function') {
                    listener.userAuthenticated(userJid, identity, sessionId);
                }
            } catch (error) {
                logger.error('Error notifying authentication listener:', error);
            }
        });
    }

    _createNonExistingUUID() {
        let uuid;
        do {
            uuid = uuidv4();
        } while (this.authenticationSessions.has(uuid));
        return uuid;
    }

    _checkExpiredSessions() {
        const now = Date.now();
        const sessionsToRemove = [];
        
        for (const [sessionId, session] of this.authenticationSessions) {
            if (now - session.createdAt > this.authenticationLifetime) {
                sessionsToRemove.push(sessionId);
            }
        }
        
        sessionsToRemove.forEach(sessionId => this.destroySession(sessionId));
    }
}

class XmppDomainAuthAuthority extends AbstractAuthAuthority {
    constructor(enableAutoLogin, authenticationLifetime, domain) {
        super(enableAutoLogin, authenticationLifetime);
        this.domain = domain;
        logger.info(`XmppDomainAuthAuthority initialized for domain: ${domain}`);
    }

    verifyJid(fullJid) {
        // Check if the JID's domain matches our trusted domain
        const jidDomain = fullJid.split('@')[1]?.split('/')[0];
        return jidDomain === this.domain;
    }

    processAuthLocked(query, response) {
        const peerJid = query.from;
        const sessionId = query.sessionId;
        const session = this.getSession(sessionId);

        // Check for invalid session
        const error = this.verifySession(query);
        if (error) {
            return error;
        }

        // Create new session if JID is valid
        if (!session && this.verifyJid(peerJid)) {
            const machineUID = query.machineUID;
            if (!machineUID) {
                return { type: 'error', error: 'Missing mandatory machine UID' };
            }
            
            const bareJid = peerJid.split('/')[0]; // Remove resource part
            this.createNewSession(machineUID, bareJid, query.room);
        }

        // Authenticate JID with session (if it exists)
        if (session) {
            this.authenticateJidWithSession(session, peerJid, response);
        }

        return null;
    }

    createLoginUrl(machineUID, peerFullJid, roomName, popup) {
        return `./${roomName.split('@')[0]}?login=true`;
    }

    isExternal() {
        return false;
    }

    createLogoutUrl(sessionId) {
        return null;
    }
}

class ExternalJWTAuthority extends XmppDomainAuthAuthority {
    constructor(domain) {
        // For external JWT type of authentication we do not want to persist
        // the session IDs longer than the duration of the conference.
        // Also session duration is limited to 1 minute. This is how long it
        // can be used for "on the fly" user role upgrade.
        super(false, 60000); // 1 minute = 60000
        logger.info(`ExternalJWTAuthority initialized for domain: ${domain}`);
    }

    createLoginUrl(machineUID, peerFullJid, roomName, popup) {
        // Login URL is configured/generated in the client
        return null;
    }

    isExternal() {
        return true;
    }
}

module.exports = {
    AbstractAuthAuthority,
    XmppDomainAuthAuthority,
    ExternalJWTAuthority
};
