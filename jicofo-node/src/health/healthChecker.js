const logger = require('../utils/logger');

class JicofoHealthChecker {
    constructor(config, focusManager, bridgeSelector, xmppConnections) {
        logger.info('JicofoHealthChecker initializing...');
        this.config = config;
        this.focusManager = focusManager;
        this.bridgeSelector = bridgeSelector;
        this.xmppConnections = xmppConnections; // Collection of XMPP connection objects
        this.totalSlowHealthChecks = 0;
        this.healthChecker = null;
        this.isRunning = false;
        
        // Default healthy state
        this.result = {
            success: true,
            hardFailure: false,
            responseCode: 200,
            sticky: false,
            message: "OK"
        };

        this._initializeHealthChecker();
        logger.info('JicofoHealthChecker initialized.');
    }

    _initializeHealthChecker() {
        // Create a periodic health checker
        this.healthChecker = {
            start: () => {
                this.isRunning = true;
                this._scheduleNextCheck();
            },
            stop: () => {
                this.isRunning = false;
                if (this.checkTimer) {
                    clearTimeout(this.checkTimer);
                    this.checkTimer = null;
                }
            }
        };
    }

    _scheduleNextCheck() {
        if (!this.isRunning) return;
        
        this.checkTimer = setTimeout(() => {
            this._performCheck();
            this._scheduleNextCheck();
        }, this.config.interval || 30000); // Default 30seconds
    }

    async _performCheck() {
        const start = Date.now();
        try {
            const checkResult = await this._check();
            this.result = checkResult;
            
            const duration = Date.now() - start;
            if (duration > (this.config.maxCheckDuration || 5000)) {
                logger.error(`Health check took too long: ${duration} ms`);
                this.totalSlowHealthChecks++;
            }
            
            // Update metrics if available
            if (global.JicofoMetricsContainer) {
                global.JicofoMetricsContainer.instance?.metricsUpdater?.updateMetrics();
            }
        } catch (error) {
            logger.error('Health check failed:', error);
            this.result = {
                success: false,
                hardFailure: false,
                responseCode: 500,
                sticky: false,
                message: `Health check error: ${error.message}`
            };
        }
    }

    async _check() {       // Check if we have operational bridges
        if (this.bridgeSelector.operationalBridgeCount <= 0) {
            return {
                success: false,
                hardFailure: true,
                responseCode: 503,
                sticky: false,
                message: `No operational bridges available (total bridge count: ${this.bridgeSelector.bridgeCount || 0})`
            };
        }

        // Generate a pseudo-random room name for testing
        const roomName = this._generateRoomName();
        
        // Check if conference already exists
        if (this.focusManager.getConference(roomName)) {
            return {
                success: false,
                hardFailure: false,
                responseCode: 503,
                sticky: false,
                message: "Test room name collision, retrying..."
            };
        }

        // Create a test conference
        try {
            const conferenceStarted = await this.focusManager.conferenceRequest(
                roomName,
                null, // empty properties
                'WARNING', // logging level
                false // include in statistics
            );

            if (!conferenceStarted) {
                return {
                    success: false,
                    hardFailure: true,
                    responseCode: 503,
                    sticky: false,
                    message: "Test conference failed to start."
                };
            }

            // Clean up the test conference
            setTimeout(() => {
                try {
                    this.focusManager.endConference(roomName);
                } catch (error) {
                    logger.warn('Failed to clean up test conference:', error);
                }
            }, 5000); // Clean up after 5seconds

        } catch (error) {
            // Treat timeouts as "soft" failures
            if (error.message.includes('timeout') || error.message.includes('NoResponseException')) {
                return {
                    success: false,
                    hardFailure: false,
                    responseCode: 503,
                    sticky: false,
                    message: "Test conference failed to start due to timeout."
                };
            }
            throw error;
        }

        // Ping XMPP connections
        try {
            await this._pingXmppConnections();
        } catch (error) {
            return {
                success: false,
                hardFailure: false,
                responseCode: 503,
                sticky: false,
                message: `XMPP ping failed: ${error.message}`
            };
        }

        return {
            success: true,
            hardFailure: false,
            responseCode: 200,
            sticky: false,
            message: "OK"
        };
    }

    async _pingXmppConnections() {
        const pingPromises = Array.from(this.xmppConnections).map(connection => 
            this._pingXmppConnection(connection)
        );
        
        await Promise.all(pingPromises);
    }

    async _pingXmppConnection(xmppConnection) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`XMPP ping timeout for ${xmppConnection.config?.name || 'unknown'}`));
            }, 5000); // 5meout

            try {
                // Send a ping stanza
                const pingStanza = {
                    type: 'ping',
                    to: xmppConnection.config?.xmppDomain || 'localhost'
                };

                xmppConnection.sendStanza(pingStanza, (error) => {
                    clearTimeout(timeout);
                    if (error) {
                        reject(new Error(`XMPP ping failed: ${error.message}`));
                    } else {
                        resolve();
                    }
                });

            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    _generateRoomName() {
        const prefix = this.config.roomNamePrefix || 'health-check';
        const randomId = Math.floor(Math.random() * 1000000);
        return `${prefix}-${randomId}`;
    }

    start() {
        logger.info('JicofoHealthChecker starting...');
        this.healthChecker.start();
        // Perform initial check
        this._performCheck();
    }

    shutdown() {
        logger.info('JicofoHealthChecker shutting down...');
        this.healthChecker.stop();
    }

    // Method to get current health status
    getCurrentHealth() {
        return this.result;
    }

    // Method to force a health check
    async forceCheck() {
        await this._performCheck();
        return this.result;
    }
}

module.exports = JicofoHealthChecker;
