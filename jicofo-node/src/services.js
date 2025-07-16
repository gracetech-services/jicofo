const logger = require('./utils/logger');
const jicofoConfig = require('./config'); // Import the main config accessor
const FocusManager = require('./conference/focusManager');
const { XmppDomainAuthAuthority, ExternalJWTAuthority } = require('./auth/authService');
const { XmppServices, initializeSmack } = require('./xmpp/xmppServices');
const BridgeSelector = require('./bridge/bridgeSelector');
const JvbDoctor = require('./bridge/jvbDoctor');
const BridgeMucDetector = require('./bridge/bridgeMucDetector');
const { JibriDetector, JibriDetectorMetrics } = require('./jibri/jibriDetector');
const JicofoHealthChecker = require('./health/healthChecker');
const ApiService = require('./api/index'); // Ktor equivalent
const { JicofoMetricsContainer, GlobalMetrics } = require('./metrics/metricsContainer');
const { AuthConfig, BridgeConfig, JibriConfig, HealthConfig, RestConfig, JidUtils } = require('./config/serviceConfigs');
const BridgeMucDetectorReal = require('./selector/bridge/bridgeMucDetector'); // Renamed to avoid conflict with property name

// TODO: CurrentVersionImpl equivalent for versioning
const CurrentVersionImpl = { VERSION: '0.0.1-node' };


class JicofoServices {
    constructor() {
        logger.info('JicofoServices constructor executing...');
        this.jicofoConfig = jicofoConfig; // Make config available to services

        // Init Smack (XMPP library)
        initializeSmack();

        this.focusManager = new FocusManager(this /* pass JicofoServices instance */);
        // this.focusManager.start() is called after this.authenticationAuthority is set up if auth is enabled.

        this.authenticationAuthority = this._createAuthenticationAuthority();
        if (this.authenticationAuthority) {
            this.focusManager.addListener(this.authenticationAuthority);
        }
        this.focusManager.start(); // Start FocusManager after potential auth listener registration


        this.xmppServices = new XmppServices({
            conferenceStore: this.focusManager, // JicofoServices.focusManager implements ConferenceStore
            focusManager: this.focusManager, // TODO: Original Kotlin notes "do not use FocusManager directly"
            authenticationAuthority: this.authenticationAuthority
        });
        this.xmppServices.clientConnection.addListener(this.focusManager); // FocusManager listens to XMPP client

        this.bridgeSelector = new BridgeSelector({ strategyConfig: BridgeConfig.config.selectionStrategy });

        if (BridgeConfig.config.healthChecksEnabled) {
            this.jvbDoctor = new JvbDoctor(this.bridgeSelector, this.xmppServices.getXmppConnectionByName(BridgeConfig.config.xmppConnectionName));
            this.bridgeSelector.addHandler(this.jvbDoctor);
        } else {
            logger.warn('JVB health-checks disabled by config.');
            this.jvbDoctor = null;
        }

        if (BridgeConfig.config.breweryJid) {
            this.bridgeMucDetector = new BridgeMucDetectorReal( // Use the aliased import
                this.xmppServices.getXmppConnectionByName(BridgeConfig.config.xmppConnectionName),
                this.bridgeSelector,
                BridgeConfig.config.breweryJid,
                this.jicofoConfig.getOptionalConfig('focusUser.nickname', 'FocusDetector'), // Distinct nickname
                this // Pass JicofoServices instance for config access etc.
            );
            // start() call for bridgeMucDetector is deferred to JicofoServices.start() method
        } else {
            logger.error('No Bridge MUC Detector configured (missing bridge.breweryJid in config).');
            this.bridgeMucDetector = null;
        }

        if (JibriConfig.config.breweryJid) {
            this.jibriDetector = new JibriDetector(
                this.xmppServices.getXmppConnectionByName(JibriConfig.config.xmppConnectionName),
                JibriConfig.config.breweryJid,
                false // isSip = false
            );
            // init() call is deferred to start() method
        } else {
            logger.info('No Jibri detector configured (missing jibri.breweryJid).');
            this.jibriDetector = null;
        }

        if (JibriConfig.config.sipBreweryJid) {
            this.sipJibriDetector = new JibriDetector(
                this.xmppServices.clientConnection, // Uses client connection as per Kotlin
                JibriConfig.config.sipBreweryJid,
                true // isSip = true
            );
            // init() call is deferred to start() method
        } else {
            logger.info('No SIP Jibri detector configured (missing jibri.sipBreweryJid).');
            this.sipJibriDetector = null;
        }

        if (this.jibriDetector || this.sipJibriDetector) {
            JicofoMetricsContainer.instance.metricsUpdater.addUpdateTask(() => {
                JibriDetectorMetrics.updateMetrics({
                    jibriDetector: this.jibriDetector,
                    sipJibriDetector: this.sipJibriDetector
                });
            });
        }

        if (HealthConfig.config.enabled) {
            this.healthChecker = new JicofoHealthChecker(
                HealthConfig.config,
                this.focusManager,
                this.bridgeSelector,
                new Set([this.xmppServices.clientConnection]) // Pass a set of connections
            );
            // start() call is deferred to start() method
        } else {
            this.healthChecker = null;
        }

        if (RestConfig.config.enabled) {
            this.apiService = new ApiService( // Ktor equivalent
                this.healthChecker,
                this.xmppServices.conferenceIqHandler,
                this.focusManager,
                this.bridgeSelector,
                () => this.getStats(),
                (full, confId) => {
                    if (confId == null) {
                        return this.getDebugState(full);
                    }
                    return this.getConferenceDebugState(confId);
                }
            );
            // Start for apiService is called in main JicofoServices.start()
        } else {
            logger.info('REST API interface disabled by config.');
            this.apiService = null;
        }

        logger.info('Registering GlobalMetrics periodic updates.');
        JicofoMetricsContainer.instance.metricsUpdater.addUpdateTask(GlobalMetrics.update);

        // Start the metrics updater
        JicofoMetricsContainer.instance.metricsUpdater.start();

        logger.info('JicofoServices constructor finished.');
    }

    _createAuthenticationAuthority() {
        const authConfig = AuthConfig.config;
        if (authConfig.type !== 'NONE') {
            logger.info(`Starting authentication service with type: ${authConfig.type}`);
            switch (authConfig.type) {
                case 'XMPP':
                    // Ensure loginUrl is a domain for XMPPDomainAuthAuthority
                    const loginDomain = JidCreate.domainBareFrom(authConfig.loginUrl);
                    if (!loginDomain) {
                        logger.error('XMPP Auth: loginUrl is not a valid JID or domain.');
                        return null;
                    }
                    return new XmppDomainAuthAuthority(
                        authConfig.enableAutoLogin,
                        authConfig.authenticationLifetime,
                        loginDomain
                    );
                case 'JWT':
                    const jwtLoginDomain = JidCreate.domainBareFrom(authConfig.loginUrl);
                     if (!jwtLoginDomain) {
                        logger.error('JWT Auth: loginUrl is not a valid JID or domain.');
                        return null;
                    }
                    return new ExternalJWTAuthority(jwtLoginDomain);
                default:
                    logger.warn(`Unknown authentication type: ${authConfig.type}`);
                    return null;
            }
        } else {
            logger.info('Authentication service disabled.');
            return null;
        }
    }

    start() {
        logger.info('JicofoServices starting dependent services...');
        this.authenticationAuthority?.start();

        this.xmppServices.startConnections() // Start XMPP connections
            .then(() => {
                // Start detectors that rely on XMPP being connected
                this.bridgeMucDetector?.start(); // Start the BridgeMucDetector
                this.jibriDetector?.init(); // Assuming init joins MUCs, might need similar async start
                this.sipJibriDetector?.init();
            })
            .catch(err => {
                logger.error("Failed to start XMPP connections, some detectors may not start:", err);
                // Potentially stop Jicofo or enter a degraded state
            });

        // FocusManager is already started after auth authority creation in constructor
        this.healthChecker?.start();

        if (this.apiService) {
            const restApiConfig = RestConfig.config;
            this.apiService.start(restApiConfig.port, restApiConfig.host);
        }
        logger.info('JicofoServices dependent services started.');
    }

    shutdown() {
        logger.info('JicofoServices shutting down...');

        if (this.authenticationAuthority) {
            this.focusManager.removeListener(this.authenticationAuthority);
            this.authenticationAuthority.shutdown();
        }
        this.healthChecker?.shutdown();
        JicofoMetricsContainer.instance.metricsUpdater.stop();
        this.apiService?.stop().catch(e => logger.error("Error stopping API service:", e)); // Assuming stop is async

        if (this.jvbDoctor) {
            this.bridgeSelector.removeHandler(this.jvbDoctor);
            this.jvbDoctor.shutdown();
        }
        this.bridgeDetector?.shutdown();
        this.jibriDetector?.shutdown();
        this.sipJibriDetector?.shutdown();

        if (this.xmppServices) {
            this.xmppServices.clientConnection.removeListener(this.focusManager);
            this.xmppServices.shutdown();
        }
        // this.focusManager.shutdown(); // Assuming FocusManager has a shutdown method

        logger.info('JicofoServices shutdown complete.');
    }

    getStats() {
        logger.debug("JicofoServices getStats called");
        JicofoMetricsContainer.instance.metricsUpdater.updateMetrics(); // Update metrics before reading

        const stats = {
            ...(this.focusManager?.stats || { focus_manager: "not_initialized" }),
            bridge_selector: this.bridgeSelector?.stats || {},
            jigasi_detector: this.xmppServices?.jigasiDetector?.stats || {},
            jigasi: this.xmppServices?.jigasiStats || {},
            threads: GlobalMetrics.threadCount?.get ? GlobalMetrics.threadCount.get() : (metricsStore.get('threads')?.currentValue || 0), // Placeholder
            jingle: {}, // Placeholder for JingleStats.toJson()
            version: CurrentVersionImpl.VERSION,
        };

        JibriDetectorMetrics.appendStats(stats);

        if (this.healthChecker) {
            const result = this.healthChecker.getCurrentHealth();
            stats.slow_health_check = this.healthChecker.totalSlowHealthChecks;
            stats.healthy = result.success;
            stats.health = {
                success: result.success,
                hardFailure: result.hardFailure,
                responseCode: result.responseCode,
                sticky: result.sticky,
                message: result.message
            };
        }
        return stats; // Should be OrderedJsonObject in Java, regular object here.
    }

    getDebugState(full = false) {
        logger.debug(`JicofoServices getDebugState (full=${full}) called`);
        return {
            focus_manager: this.focusManager?.getDebugState(full) || {},
            bridge_selector: this.bridgeSelector?.debugState || {},
            jibri_detector: this.jibriDetector?.debugState || "null",
            sip_jibri_detector: this.sipJibriDetector?.debugState || "null",
            jigasi_detector: this.xmppServices?.jigasiDetector?.debugState || "null",
            av_moderation: this.xmppServices?.avModerationHandler?.debugState || {},
            conference_iq_handler: this.xmppServices?.conferenceIqHandler?.debugState || {},
        };
    }

    getConferenceDebugState(conferenceIdString) {
        logger.debug(`JicofoServices getConferenceDebugState for ${conferenceIdString} called`);
        // const conferenceJid = JidCreate.entityBareFrom(conferenceIdString); // Needs robust JID parsing
        // if (!conferenceJid) return { error: "Invalid conference ID format" };
        const conference = this.focusManager?.getConference(conferenceIdString /* conferenceJid */);
        return conference?.debugState || {};
    }
}

// Singleton instance management
let jicofoServicesSingleton = null;
const jicofoServicesSingletonSyncRoot = Symbol('JicofoServicesSingletonSyncRoot');

function getJicofoServicesSingleton() {
    return jicofoServicesSingleton;
}

function setJicofoServicesSingleton(instance) {
    jicofoServicesSingleton = instance;
    logger.info(`JicofoServices singleton ${instance ? 'set' : 'cleared'}.`);
}

function shutdownTaskPools() {
    logger.info('Global TaskPools shutdown (Node.js: TBD, likely managed by specific modules like worker_threads if used).');
}

// Version metric registration (from companion object in Kotlin)
JicofoMetricsContainer.instance.registerInfo(
    "version",
    "Application version",
    CurrentVersionImpl.VERSION
);


module.exports = {
    JicofoServices,
    getJicofoServicesSingleton,
    setJicofoServicesSingleton,
    jicofoServicesSingletonSyncRoot,
    shutdownTaskPools
};
