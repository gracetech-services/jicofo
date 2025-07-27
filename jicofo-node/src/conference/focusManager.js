const logger = require('../utils/logger');
const { JicofoMetricsContainer } = require('../metrics/metricsContainer');
// const JitsiMeetConferenceImpl = require('./jitsiMeetConference'); // Will be needed later
const { JidUtils } = require('../config/serviceConfigs'); // Updated to JidUtils
const JitsiMeetConference = require('./jitsiMeetConference'); // Use the new class

// Mock JitsiMeetConferenceImpl for now - REMOVED, using JitsiMeetConference now
// class JitsiMeetConferenceImplMock {
// constructor(roomName, focusManager, properties, logLevel, jvbVersion, includeInStatistics, jicofoSrv) {
// this.roomName = roomName;
// this.focusManager = focusManager;
// this.properties = properties;
// this.logLevel = logLevel;
// this.jvbVersion = jvbVersion;
// this.includeInStatistics = includeInStatistics;
// this.jicofoSrv = jicofoSrv;
// this.isStarted = false;
// this.participantCount = 0;
// this.visitorCount = 0;
// this.mainRoomJid = null; // For breakout rooms
// this.jibriRecorder = null;
// this.jibriSipGateway = null;
// logger.info(`Mock JitsiMeetConferenceImpl created for ${roomName}`);
// }
// start() { this.isStarted = true; logger.info(`Mock Conference ${this.roomName} started.`); }
// get participantCount() { return this._participantCount || 0; }
// set participantCount(val) { this._participantCount = val; }
// get visitorCount() { return this._visitorCount || 0; }
// set visitorCount(val) { this._visitorCount = val; }
//
// get debugState() { return { mock: true, name: this.roomName.toString(), participants: this.participantCount }; }
// registrationChanged(registered) { logger.info(`Mock Conference ${this.roomName} registrationChanged: ${registered}`); }
// breakoutConferenceEnded() { logger.info(`Mock Conference ${this.roomName} received breakoutConferenceEnded.`); }
// includeInStatistics() { return this._includeInStatistics !== false; }
// }


const ConferenceMetrics = { // Placeholder, real metrics will be in metricsContainer.js
    conferenceCount: { inc: () => {}, dec: () => {}, get: () => 0 },
    conferencesCreated: { inc: () => {}, get: () => 0 },
    largestConference: { set: () => {}, get: () => 0 },
    currentParticipants: { set: () => {}, get: () => 0 },
    conferenceSizes: { addValue: () => {}, toJson: () => ({}), get: () => {} },
    participantPairs: { set: () => {}, get: () => 0 },
    conferencesWithVisitors: { set: () => {}, get: () => 0 },
    currentVisitors: { set: () => {}, get: () => 0 },
    participantsMoved: { get: () => 0 },
    bridgesRemoved: { get: () => 0 },
    participantsIceFailed: { get: () => 0 },
    participantsRequestedRestart: { get: () => 0 }
};

const JibriStats = { // Placeholder
    liveStreamingActive: { set: () => {}, get: () => 0 },
    recordingActive: { set: () => {}, get: () => 0 },
    sipActive: { set: () => {}, get: () => 0 },
    sipFailures: { get: () => 0 },
    liveStreamingFailures: { get: () => 0 },
    recordingFailures: { get: () => 0 }
};


class FocusManager /* implements ConferenceStore, XmppProvider.Listener */ {
    constructor(jicofoSrv, clock = Date) { // jicofoSrv is the JicofoServices instance, clock for pinning
        logger.info('FocusManager initializing...');
        this.jicofoSrv = jicofoSrv;
        this.clock = clock; // For Date.now() or a mockable clock

        // Using simple Map and Array for now. Concurrency considerations for Node.js:
        // JavaScript is single-threaded, so direct data corruption from simultaneous access isn't an issue.
        // However, if async operations are involved within "synchronized" blocks, care is needed.
        // For now, assuming operations are quick or will use async/await properly.
        this.conferences = new Map(); // EntityBareJid -> JitsiMeetConferenceImpl
        this.conferencesCache = []; // JitsiMeetConferenceImpl[] - CopyOnWriteArrayList equivalent for reads

        this.listeners = []; // ConferenceStore.Listener[]
        this.pinnedConferences = new Map(); // EntityBareJid -> PinnedConferenceState

        this.stats = {}; // Will be populated by getStats()
        logger.info('FocusManager initialized.');
    }

    start() {
        logger.info('FocusManager starting...');
        JicofoMetricsContainer.instance.metricsUpdater.addUpdateTask(() => this.updateMetrics());
    }

    hasBreakoutRooms(jid) { // jid is expected to be a string
        // room.mainRoomJid == jid
        const bareJidToCompare = JidUtils.entityBareFrom(jid);
        if (!bareJidToCompare) return false;
        return this.conferencesCache.some(conf =>
            conf.mainRoomJid && JidUtils.bareEq(conf.mainRoomJid, bareJidToCompare)
        );
    }

    async conferenceRequest(room, properties, loggingLevel = 'ALL', includeInStatistics = true) {
        // JID handling: In Node, room would likely be a string. Proper JID parsing needed.
        const roomJidString = JidUtils.entityBareFrom(room); // Normalize to bare JID string for map key
        if (!roomJidString) {
            logger.error(`Invalid room JID provided for conferenceRequest: ${room}`);
            throw new Error(`Invalid room JID: ${room}`);
        }

        let conference = this.conferences.get(roomJidString);
        let isConferenceCreator = false;

        if (!conference) {
            conference = this._createConference(roomJid, properties, loggingLevel, includeInStatistics);
            isConferenceCreator = true;
        }

        try {
            if (isConferenceCreator) {
                // In Kotlin, conference.start() could throw.
                // Assuming JitsiMeetConferenceImplMock.start() is synchronous for now.
                conference.start();
            }
        } catch (e) {
            logger.warn(`Exception while trying to start conference ${roomJidString}:`, e);
            // If creation failed and it was added to map, remove it.
            if (isConferenceCreator && this.conferences.get(roomJidString) === conference) {
                this.conferences.delete(roomJidString);
                this.conferencesCache = this.conferencesCache.filter(c => c !== conference);
                if (conference.includeInStatistics()) {
                     ConferenceMetrics.conferenceCount.dec(); // Decrement if create failed after inc
                }
            }
            throw e;
        }
        return conference.isStarted;
    }

    _createConference(roomJidString, properties, logLevel, includeInStatistics) {
        // roomJidString is already a bare JID string from conferenceRequest
        const jvbVersion = this.getBridgeVersionForConference(roomJidString);

        // Using the actual (though skeletal) JitsiMeetConference class now
        const conference = new JitsiMeetConference(
            roomJidString,
            this, // ConferenceListener - FocusManager itself
            properties,
            logLevel,
            jvbVersion,
            includeInStatistics,
            this.jicofoSrv
        );

        this.conferences.set(roomJid, conference);
        this.conferencesCache = [...this.conferencesCache, conference]; // Simulate CopyOnWrite by creating new array

        if (conference.includeInStatistics()) {
            ConferenceMetrics.conferenceCount.inc();
            ConferenceMetrics.conferencesCreated.inc();
        }
        return conference;
    }

    conferenceEnded(conference) { // conference is JitsiMeetConferenceImpl
        const roomName = conference.roomName; // Assuming roomName is the JID string

        if (this.conferences.get(roomName) === conference) {
            this.conferences.delete(roomName);
            this.conferencesCache = this.conferencesCache.filter(c => c !== conference);
            if (conference.includeInStatistics()) {
                ConferenceMetrics.conferenceCount.dec();
            }

            // If this was a breakout room, tell the main conference that it ended.
            const mainRoomJidStr = conference.mainRoomJid;
            if (mainRoomJidStr) {
                const bareMainRoomJid = JidUtils.entityBareFrom(mainRoomJidStr);
                if (bareMainRoomJid) {
                    const mainConference = this.conferences.get(bareMainRoomJid);
                    if (mainConference) {
                        // TaskPools.ioPool.submit -> Node.js: setImmediate or just async call
                        setImmediate(() => mainConference.breakoutConferenceEnded());
                    }
                } else {
                    logger.warn(`Could not parse mainRoomJid: ${mainRoomJidStr} for ended conference ${roomName}`);
                }
            }
        } else {
            logger.warn(`Conference ${roomName} ended but was not found in the active map or was a different instance.`);
        }

        // Notify listeners
        const listenersCopy = [...this.listeners]; // Iterate over a copy
        for (const listener of listenersCopy) {
            try {
                listener.conferenceEnded(roomName); // roomName is already a bare JID string
            } catch (error) {
                logger.error(`Error in conferenceEnded listener for ${roomName}:`, error);
            }
        }
    }

    getConference(jid) { // jid is a string
        const roomJidString = JidUtils.entityBareFrom(jid);
        return roomJidString ? this.conferences.get(roomJidString) : null;
    }

    getAllConferences() {
        return this.getConferences();
    }

    getConferences() {
        return [...this.conferencesCache]; // Return a copy
    }

    addListener(listener) {
        if (!this.listeners.includes(listener)) {
            this.listeners.push(listener);
        }
    }

    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    updateMetrics() {
        // logger.debug('FocusManager updating metrics...');
        let numParticipants = 0;
        let largestConferenceSize = 0;
        const conferenceSizes = { addValue: (val) => { /* TODO */ }, toJson: () => ({ /*TODO*/ }) }; // Placeholder for ConferenceSizeBuckets
        let endpointPairs = 0;
        const jibriSessions = new Set(); // JibriSession objects
        let conferencesWithVisitors = 0;
        let visitors = 0;

        const currentConferences = this.getConferences(); // Use cached list

        for (const conference of currentConferences) {
            if (!conference.includeInStatistics()) {
                continue;
            }
            let confSize = conference.participantCount;
            const conferenceVisitors = conference.visitorCount;
            visitors += conferenceVisitors;
            if (conferenceVisitors > 0) {
                conferencesWithVisitors++;
            }
            if (confSize === 0 && conference.isStarted) { // Adjusted logic slightly from Kotlin
                confSize = 1; // As per Kotlin comment
            }
            numParticipants += confSize;
            endpointPairs += confSize * confSize;
            largestConferenceSize = Math.max(largestConferenceSize, confSize);
            // conferenceSizes.addValue(confSize); // TODO: Implement ConferenceSizeBuckets equivalent

            // conference.jibriRecorder?.let { jibriSessions.addAll(it.jibriSessions) }
            // conference.jibriSipGateway?.let { jibriSessions.addAll(it.jibriSessions) }
            // Simplified: Assume jibriSessions are directly on conference for mock
            if (conference.jibriRecorder?.jibriSessions) conference.jibriRecorder.jibriSessions.forEach(s => jibriSessions.add(s));
            if (conference.jibriSipGateway?.jibriSessions) conference.jibriSipGateway.jibriSessions.forEach(s => jibriSessions.add(s));
        }

        ConferenceMetrics.largestConference.set(largestConferenceSize);
        ConferenceMetrics.currentParticipants.set(numParticipants);
        // ConferenceMetrics.conferenceSizes = conferenceSizes; // TODO
        ConferenceMetrics.participantPairs.set(endpointPairs);
        ConferenceMetrics.conferencesWithVisitors.set(conferencesWithVisitors);
        ConferenceMetrics.currentVisitors.set(visitors);

        // Filter Jibri sessions by type and active status (mocked for now)
        // JibriStats.liveStreamingActive.set(Array.from(jibriSessions).filter(s => s.jibriType === 'LIVE_STREAMING' && s.isActive).length);
        // JibriStats.recordingActive.set(Array.from(jibriSessions).filter(s => s.jibriType === 'RECORDING' && s.isActive).length);
        // JibriStats.sipActive.set(Array.from(jibriSessions).filter(s => s.jibriType === 'SIP_CALL' && s.isActive).length);
    }

    getStats() {
        // This should ideally use the metrics updated by updateMetrics()
        // For now, directly accessing ConferenceMetrics and JibriStats placeholders
        const stats = {}; // OrderedJsonObject equivalent
        stats["total_participants"] = ConferenceMetrics.participants?.get() || 0;
        stats["total_conferences_created"] = ConferenceMetrics.conferencesCreated.get();
        stats["conferences"] = ConferenceMetrics.conferenceCount.get();
        stats["conferences_with_visitors"] = ConferenceMetrics.conferencesWithVisitors.get();

        const bridgeFailures = {};
        bridgeFailures["participants_moved"] = ConferenceMetrics.participantsMoved.get();
        bridgeFailures["bridges_removed"] = ConferenceMetrics.bridgesRemoved.get();
        stats["bridge_failures"] = bridgeFailures;

        const participantNotifications = {};
        participantNotifications["ice_failed"] = ConferenceMetrics.participantsIceFailed.get();
        participantNotifications["request_restart"] = ConferenceMetrics.participantsRequestedRestart.get();
        stats["participant_notifications"] = participantNotifications;

        stats["largest_conference"] = ConferenceMetrics.largestConference.get();
        stats["participants"] = ConferenceMetrics.currentParticipants.get();
        stats["visitors"] = ConferenceMetrics.currentVisitors.get();
        stats["conference_sizes"] = ConferenceMetrics.conferenceSizes.toJson();
        stats["endpoint_pairs"] = ConferenceMetrics.participantPairs.get();

        stats["jibri"] = {
            total_sip_call_failures: JibriStats.sipFailures.get(),
            total_live_streaming_failures: JibriStats.liveStreamingFailures.get(),
            total_recording_failures: JibriStats.recordingFailures.get(),
            live_streaming_active: JibriStats.liveStreamingActive.get(),
            recording_active: JibriStats.recordingActive.get(),
            sip_call_active: JibriStats.sipActive.get()
        };
        // stats["queues"] = getStatistics(); // QueueStatistics.getStatistics() - needs translation
        stats["queues"] = {}; // Placeholder
        return stats;
    }

    getDebugState(full = false) {
        const debugState = {};
        const currentConferences = this.getConferences();
        for (const conference of currentConferences) {
            const roomNameStr = conference.roomName.toString(); // Ensure string key
            if (full) {
                debugState[roomNameStr] = conference.debugState;
            } else {
                debugState[roomNameStr] = conference.participantCount;
            }
        }
        return debugState;
    }

    // --- Pinning Logic ---
    pinConference(roomName, jvbVersion, durationMs) { // duration is ms, roomName is a string JID
        const roomJidString = JidUtils.entityBareFrom(roomName);
        if (!roomJidString) {
            logger.error(`Invalid room JID provided for pinConference: ${roomName}`);
            return;
        }
        const expiresAt = new this.clock.constructor(this.clock.now() + durationMs).toISOString(); // Use provided clock
        const pinState = { jvbVersion, expiresAt, durationMs };

        const prev = this.pinnedConferences.get(roomJidString);
        this.pinnedConferences.set(roomJidString, pinState);

        if (prev) {
            logger.info(`Modifying pin for ${roomJidString}`);
        }
        logger.info(`Pinning ${roomJidString} to version "${jvbVersion}" for ${durationMs / 60000} minute(s).`);
    }

    unpinConference(roomName) { // roomName is a string JID
        const roomJidString = JidUtils.entityBareFrom(roomName);
        if (!roomJidString) {
            logger.error(`Invalid room JID provided for unpinConference: ${roomName}`);
            return;
        }
        const prev = this.pinnedConferences.delete(roomJidString);
        logger.info(prev ? `Removing pin for ${roomJidString}` : `Unpin failed: ${roomJidString} was not pinned.`);
    }

    _expirePins() {
        const now = new this.clock.constructor(this.clock.now()).toISOString();
        let changed = false;
        // Iterate over keys to safely delete from the map during iteration
        for (const roomJidString of this.pinnedConferences.keys()) {
            const pinState = this.pinnedConferences.get(roomJidString);
            if (pinState && pinState.expiresAt < now) {
                this.pinnedConferences.delete(roomJidString);
                changed = true;
            }
        }
        if (changed) {
            logger.info("Some conference pins have expired.");
        }
    }

    getBridgeVersionForConference(roomName) { // roomName is a string JID (expected bare)
        this._expirePins();
        // roomName is expected to be a bare JID string already by callers like _createConference
        const pinState = this.pinnedConferences.get(roomName);
        return pinState ? pinState.jvbVersion : null;
    }

    getPinnedConferences() {
        this._expirePins();
        const result = [];
        for (const [conferenceId, p] of this.pinnedConferences) {
            result.push({
                conferenceId: conferenceId.toString(), // Ensure string
                jvbVersion: p.jvbVersion,
                expiresAt: p.expiresAt
            });
        }
        return result;
    }

    // XmppProvider.Listener interface method
    registrationChanged(registered) {
        logger.info(`FocusManager: XMPP registration status changed to: ${registered}`);
        const currentConferences = this.getConferences();
        currentConferences.forEach(conference => {
            try {
                conference.registrationChanged(registered);
            } catch (error) {
                logger.error(`Error notifying conference ${conference.roomName} of registration change:`, error);
            }
        });
    }
}

module.exports = FocusManager;
