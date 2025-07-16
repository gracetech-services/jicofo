const { createElement, Element } = require('@xmpp/xml');
const loggerModule = require('../../../utils/logger');
const ConferenceSourceMap = require('../../conference/source/conferenceSourceMap');
const { createSessionInitiate, createTransportReplace, createBundleGroupExtension } = require('./jingleUtils');
const { JingleAction, State, JingleReason } = require('./jingleConstants');
const { jingleStatsInstance } = require('./jingleStats');

// Helper to create Jitsi's JsonMessageExtension for sources
function createJsonSourcesMessageExtension(conferenceSourceMap) {
    if (!conferenceSourceMap || !(conferenceSourceMap instanceof ConferenceSourceMap) || conferenceSourceMap.isEmpty()) {
        return null;
    }
    const sourcesForPayload = {};
    conferenceSourceMap.forEach((endpointSet, ownerId) => {
        sourcesForPayload[ownerId] = JSON.parse(endpointSet.compactJson);
    });
    const payload = JSON.stringify({ sources: sourcesForPayload });
    return createElement('json-message', { xmlns: 'http://jitsi.org/jitmeet' }, payload);
}

// createBundleGroupExtension MOVED to jingleUtils.js

class JingleSession {
    constructor(
        sid,
        remoteJid,
        jingleHandler,
        xmppConnection,
        requestHandler,
        encodeSourcesAsJson
    ) {
        this.sid = sid;
        this.remoteJid = remoteJid;
        this.jingleHandler = jingleHandler;
        this.xmppConnection = xmppConnection;
        this.requestHandler = requestHandler;
        this.encodeSourcesAsJson = encodeSourcesAsJson;

        this.state = State.PENDING;
        this.localJid = this.xmppConnection.xmpp?.jid?.toString();

        this.logger = loggerModule.child({
            component: 'JingleSession',
            remoteJid: this.remoteJid,
            sid: this.sid
        });

        this.processingLock = false;
        this.incomingIqQueue = [];

        this.logger.info('JingleSession created.');
    }

    isActive() {
        return this.state === State.ACTIVE;
    }

    async processJingleIq(iq, action, jingleChildren) {
        this.logger.debug(`Queueing Jingle IQ for processing: action=${action}`);
        
        // Track statistics
        jingleStatsInstance.stanzaReceived(action);
        
        return new Promise((resolve) => {
            this.incomingIqQueue.push({ iq, action, jingleChildren, resolve });
            this._dequeueAndProcess();
        });
    }

    async _dequeueAndProcess() {
        if (this.processingLock || this.incomingIqQueue.length === 0) {
            return;
        }
        this.processingLock = true;

        const { iq, action, jingleChildren, resolve } = this.incomingIqQueue.shift();

        if (this.state === State.ENDED && action !== JingleAction.SESSION_TERMINATE) {
            this.logger.warn(`Session ended, ignoring IQ action: ${action}`);
            this.processingLock = false;
            this._dequeueAndProcess();
            if (resolve) resolve(null);
            return;
        }

        try {
            const response = await this._doProcessIq(iq, action, jingleChildren);
            if (resolve) resolve(response);
        } catch (error) {
            this.logger.error(`Error in _doProcessIq for action ${action}:`, error);
            if (resolve) resolve(null);
        } finally {
            this.processingLock = false;
            this._dequeueAndProcess();
        }
    }

    async _doProcessIq(iq, action, jingleChildren) {
        let errorStanzaPart = null;
        const from = iq.attrs.from;
        const id = iq.attrs.id;
        const contents = jingleChildren.filter(el => el.name === 'content');

        this.logger.info(`Processing Jingle IQ: action=${action}, from=${from}`);

        switch (action) {
            case JingleAction.SESSION_ACCEPT:
                this.state = State.ACTIVE;
                errorStanzaPart = await this.requestHandler.onSessionAccept(this, contents);
                if (errorStanzaPart) this.state = State.ENDED;
                break;
            case JingleAction.SESSION_INFO:
                errorStanzaPart = await this.requestHandler.onSessionInfo(this, iq);
                break;
            case JingleAction.SESSION_TERMINATE:
                errorStanzaPart = await this.requestHandler.onSessionTerminate(this, iq);
                this.state = State.ENDED;
                this.jingleHandler.unregisterSession(this.sid);
                break;
            case JingleAction.TRANSPORT_ACCEPT:
                errorStanzaPart = await this.requestHandler.onTransportAccept(this, contents);
                break;
            case JingleAction.TRANSPORT_INFO:
                errorStanzaPart = await this.requestHandler.onTransportInfo(this, contents);
                break;
            case JingleAction.TRANSPORT_REJECT:
                await this.requestHandler.onTransportReject(this, iq);
                break;
            case JingleAction.ADDSOURCE:
            case JingleAction.SOURCEADD:
                errorStanzaPart = await this.requestHandler.onAddSource(this, contents);
                break;
            case JingleAction.REMOVESOURCE:
            case JingleAction.SOURCEREMOVE:
                errorStanzaPart = await this.requestHandler.onRemoveSource(this, contents);
                break;
            default:
                this.logger.warn(`Unsupported Jingle action: ${action}`);
                errorStanzaPart = { condition: 'feature-not-implemented', text: `Unsupported action: ${action}` };
        }

        let response;
        if (errorStanzaPart) {
            this.logger.info(`Jingle action '${action}' resulted in error: ${errorStanzaPart.condition} - ${errorStanzaPart.text}`);
            const jingleErrorElement = createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', sid: this.sid });
            response = createElement('iq', { type: 'error', to: from, id },
                jingleErrorElement,
                createElement('error', { type: errorStanzaPart.type || 'cancel' },
                    createElement(errorStanzaPart.condition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }),
                    errorStanzaPart.text ? createElement('text', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }, errorStanzaPart.text) : null
                )
            );
        } else {
            response = createElement('iq', { type: 'result', to: from, id });
        }
        await this.jingleHandler.sendIq(response);
        
        // Track successful response
        jingleStatsInstance.stanzaSent(action);
        return response;
    }

    async terminate(reason, message, sendIq = true) {
        this.logger.info(`Terminating session. Reason: ${reason?.name || 'None'}, SendIQ: ${sendIq}`);
        const oldState = this.state;
        this.state = State.ENDED;

        if (oldState === State.ENDED && sendIq) {
            this.logger.warn("Not sending session-terminate IQ; session already ended.");
        } else if (sendIq) {
            const terminateIq = createElement('iq', { type: 'set', to: this.remoteJid, from: this.localJid, id: this._generateIqId() },
                createElement('jingle', {
                        xmlns: 'urn:xmpp:jingle:1',
                        action: JingleAction.SESSION_TERMINATE,
                        sid: this.sid,
                        initiator: this.localJid // Jicofo is usually initiator of the session it creates
                    },
                    reason ? createElement('reason', {}, createElement(reason.name, { xmlns: reason.xmlns })) : null,
                    message ? createElement('text', {}, message) : null // Jitsi custom for message with reason
                )
            );
            try {
                await this.jingleHandler.sendIq(terminateIq);
                jingleStatsInstance.stanzaSent(JingleAction.SESSION_TERMINATE);
            } catch (e) {
                this.logger.error('Failed to send session-terminate IQ:', e);
            }
        }
        this.jingleHandler.unregisterSession(this.sid);
        this.incomingIqQueue = [];
    }

    async initiateSession(baseContentElements = [], additionalJingleExtensions = [], sourcesMap = null) {
        this.logger.info(`Initiating Jingle session SID ${this.sid} to ${this.remoteJid}`);
        if (this.state !== State.PENDING) {
            this.logger.error(`Cannot initiate session: Already in state ${this.state}`);
            return false;
        }

        let contentElementsForIq = [];
        const jingleExtensionsToApply = [...additionalJingleExtensions];

        if (this.encodeSourcesAsJson && sourcesMap && !sourcesMap.isEmpty()) {
            const jsonExt = createJsonSourcesMessageExtension(sourcesMap);
            if (jsonExt) jingleExtensionsToApply.push(jsonExt);
            contentElementsForIq = baseContentElements.map(el => el.clone());
        } else if (sourcesMap && !sourcesMap.isEmpty()) {
            const mediaTypeToContentMap = new Map();
            baseContentElements.forEach(contentEl => {
                if (contentEl.attrs.name) {
                    mediaTypeToContentMap.set(contentEl.attrs.name, contentEl.clone());
                }
            });
            sourcesMap.toJingleContents(mediaTypeToContentMap, this.localJid);
            contentElementsForIq = Array.from(mediaTypeToContentMap.values());
        } else {
            contentElementsForIq = baseContentElements.map(el => el.clone());
        }

        contentElementsForIq.forEach(content => {
            if (!content.attrs.creator) content.attrs.creator = 'initiator';
            if (!content.attrs.disposition) content.attrs.disposition = 'session';
        });

        if (contentElementsForIq.length > 1 && !jingleExtensionsToApply.some(ext => ext.name === 'group' && ext.attrs.xmlns === 'urn:xmpp:jingle:apps:grouping:0' && ext.attrs.semantics === 'BUNDLE')) {
            const bundleGroup = createBundleGroupExtension(contentElementsForIq); // Now from jingleUtils
            if (bundleGroup) jingleExtensionsToApply.push(bundleGroup);
        }

        const sessionInitiateIq = createSessionInitiate(
            this.localJid, this.remoteJid, this.sid, contentElementsForIq
        );

        const jingleElement = sessionInitiateIq.getChild('jingle');
        jingleExtensionsToApply.forEach(ext => jingleElement.append(ext.clone()));


        this.jingleHandler.registerSession(this);
        try {
            const response = await this.jingleHandler.iqCaller.request(sessionInitiateIq);
            jingleStatsInstance.stanzaSent(JingleAction.SESSION_INITIATE);
            if (response === null || response.attrs.type === 'result') {
                this.logger.info(`session-initiate for SID ${this.sid} sent, awaiting session-accept.`);
                return true;
            } else {
                this.logger.error(`Unexpected response to session-initiate for SID ${this.sid}: ${response.toString()}`);
                this.terminate({ name: 'general-error' }, 'Failed to initiate session', false);
                return false;
            }
        } catch (error) {
            this.logger.error(`Error sending session-initiate for SID ${this.sid}:`, error);
            this.terminate({ name: 'general-error' }, 'Error initiating session', false);
            return false;
        }
    }

    async replaceTransport(contentElementsWithTransport, additionalJingleExtensions = [], sourcesMap = null) {
        this.logger.info(`Sending transport-replace for SID ${this.sid}`);
        if (this.state !== State.ACTIVE) {
            this.logger.warn(`Sending transport-replace for session in state ${this.state}, may not be appropriate.`);
        }

        const jingleExtensionsToApply = [...additionalJingleExtensions];
        let finalContentElements = (contentElementsWithTransport || []).map(el => el.clone());

        if (this.encodeSourcesAsJson && sourcesMap && !sourcesMap.isEmpty()) {
            const jsonExt = createJsonSourcesMessageExtension(sourcesMap);
            if (jsonExt) jingleExtensionsToApply.push(jsonExt);
        }

        finalContentElements.forEach(content => {
            if (!content.attrs.creator) content.attrs.creator = 'initiator';
        });

        if (finalContentElements.length > 1 && !jingleExtensionsToApply.some(ext => ext.name === 'group' && ext.attrs.xmlns === 'urn:xmpp:jingle:apps:grouping:0' && ext.attrs.semantics === 'BUNDLE')) {
             const bundleGroup = createBundleGroupExtension(finalContentElements); // Now from jingleUtils
             if (bundleGroup) jingleExtensionsToApply.push(bundleGroup);
        }

        const transportReplaceIq = createTransportReplace(
            this.localJid, this.remoteJid, this.sid, finalContentElements
        );
        const jingleElement = transportReplaceIq.getChild('jingle');
        jingleExtensionsToApply.forEach(ext => jingleElement.append(ext.clone()));

        try {
            const response = await this.jingleHandler.iqCaller.request(transportReplaceIq);
            jingleStatsInstance.stanzaSent(JingleAction.TRANSPORT_REPLACE);
            if (response?.attrs.type === 'result') {
                this.logger.info(`transport-replace for SID ${this.sid} successful.`);
                return true;
            } else {
                this.logger.error(`Unexpected response to transport-replace for SID ${this.sid}: ${response?.toString()}`);
                return false;
            }
        } catch (error) {
            this.logger.error(`Error sending transport-replace for SID ${this.sid}:`, error);
            return false;
        }
    }

    async addSource(sourcesMapToAdd) {
        this.logger.debug(`Sending source-add for SID ${this.sid}`);
        if (!this.isActive()) {
            this.logger.error(`Cannot send source-add, session not active. State: ${this.state}`);
            return;
        }
        if (!sourcesMapToAdd || sourcesMapToAdd.isEmpty()) {
            this.logger.warn(`Attempted to send source-add with no sources for SID ${this.sid}.`);
            return;
        }

        let jinglePayloadChildren = [];
        if (this.encodeSourcesAsJson) {
            const jsonExt = createJsonSourcesMessageExtension(sourcesMapToAdd);
            if (jsonExt) jinglePayloadChildren.push(jsonExt);
        } else {
            jinglePayloadChildren = sourcesMapToAdd.toJingle(this.localJid);
        }

        if (jinglePayloadChildren.length === 0) {
            this.logger.warn(`Sending source-add for SID ${this.sid} with no actual sources to add after processing.`);
            return;
        }

        const addSourceIq = createElement('iq', { type: 'set', to: this.remoteJid, from: this.localJid, id: this._generateIqId() },
            createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SOURCEADD, sid: this.sid },
                ...jinglePayloadChildren
            )
        );
        try {
            await this.jingleHandler.sendIq(addSourceIq);
            jingleStatsInstance.stanzaSent(JingleAction.SOURCEADD);
        } catch (e) {
            this.logger.error(`Failed to send source-add IQ for SID ${this.sid}:`, e);
        }
    }

    async removeSource(sourcesMapToRemove) {
        this.logger.debug(`Sending source-remove for SID ${this.sid}`);
         if (!this.isActive()) {
            this.logger.error(`Cannot send source-remove, session not active. State: ${this.state}`);
            return;
        }
        if (!sourcesMapToRemove || sourcesMapToRemove.isEmpty()) {
            this.logger.warn(`Attempted to send source-remove with no sources for SID ${this.sid}.`);
            return;
        }

        let jinglePayloadChildren = [];
        if (this.encodeSourcesAsJson) {
            const jsonExt = createJsonSourcesMessageExtension(sourcesMapToRemove);
            if (jsonExt) jinglePayloadChildren.push(jsonExt);
        } else {
            jinglePayloadChildren = sourcesMapToRemove.toJingle(this.localJid);
        }

        if (jinglePayloadChildren.length === 0) {
            this.logger.warn(`Sending source-remove for SID ${this.sid} with no actual sources to remove after processing.`);
            return;
        }

        const removeSourceIq = createElement('iq', { type: 'set', to: this.remoteJid, from: this.localJid, id: this._generateIqId() },
            createElement('jingle', { xmlns: 'urn:xmpp:jingle:1', action: JingleAction.SOURCEREMOVE, sid: this.sid },
                ...jinglePayloadChildren
            )
        );
        try {
            await this.jingleHandler.sendIq(removeSourceIq);
            jingleStatsInstance.stanzaSent(JingleAction.SOURCEREMOVE);
        } catch (e) {
            this.logger.error(`Failed to send source-remove IQ for SID ${this.sid}:`, e);
        }
    }

    _generateIqId() {
        return `jingle_${Math.random().toString(36).substring(2, 12)}`;
    }

    debugState() {
        return {
            sid: this.sid,
            remoteJid: this.remoteJid,
            localJid: this.localJid,
            state: this.state,
            encodeSourcesAsJson: this.encodeSourcesAsJson,
            queueSize: this.incomingIqQueue.length
        };
    }
}

module.exports = { JingleSession };
