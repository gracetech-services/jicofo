/*
 * Jicofo-Node, the Jitsi Conference Focus (Node.js version).
 */
const process = require('process');
const logger = require('./utils/logger');
const { getConfig, getOptionalConfig } = require('./config');
const {
    JicofoServices,
    getJicofoServicesSingleton,
    setJicofoServicesSingleton,
    shutdownTaskPools
} = require('./services');

// Simulating Java's Main class static main method
async function main() {
    logger.info('[Gracetech] Starting Jicofo-Node.');

    // Set up uncaught exception handler
    process.on('uncaughtException', (error, origin) => {
        logger.error(`An uncaught exception occurred in ${origin}:`, error);
        // Consider if process should exit, similar to Java's behavior or based on error type
        // process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        // Consider if process should exit
        // process.exit(1);
    });

    // Check for required configuration (e.g., path to config file)
    // The 'config' library typically uses NODE_ENV and NODE_CONFIG_DIR,
    // or loads from a 'config' directory.
    // We'll assume 'config' lib handles loading. If a specific file like
    // System.getProperty("config.file", "") is needed, it could be passed via env var.
    const customConfigPath = process.env.JICOFO_CONFIG_PATH || getOptionalConfig('jicofo.config.path');
    if (customConfigPath) {
        // This part would require more setup if 'config' lib needs explicit loading of one file.
        // For now, we assume 'config' lib finds its files.
        logger.info(`Custom config path specified (though 'config' lib has its own loading mechanism): ${customConfigPath}`);
    } else {
        // Check if a default critical config is missing (example)
        try {
            const xmppService = getConfig('xmpp.client.service'); // Example check
            logger.info(`xmppService config value: "${xmppService}"`);
        } catch (e) {
            // In Java: logger.warn("Required property config.file is missing. Set with -Dconfig.file="); return;
            // The 'config' library will throw an error if a default.json (or env specific) is not found in /config.
            // So, a simple check might be to try to load any config.
            logger.warn("Initial configuration check: Ensure your configuration files are set up in the 'config' directory or NODE_CONFIG_DIR is set.");
            // No specific "config.file" equivalent check for now, relying on 'config' lib's behavior.
        }
    }

    // setupMetaconfigLogger(); // This was Java specific for Metaconfig.
                              // If Metaconfig logic is ported, its logger setup would go here or in the config module.

    // JitsiConfig.Companion.reloadNewConfig(); // In Node.js 'config' lib, config is loaded on require.
                                             // Dynamic reloading would need specific implementation.

    // Make sure that passwords are not printed by ConfigurationService
    // ConfigUtils.PASSWORD_SYS_PROPS = "pass";
    // ConfigUtils.PASSWORD_CMD_LINE_ARGS = "user_password";
    // This logic should be part of the config module (./config/index.js)
    // to ensure config accessors handle redaction if necessary.
    logger.info('Password redaction rules should be applied by the config module.');


    let jicofoServicesInstance;
    try {
        // In Java: synchronized (JicofoServices.getJicofoServicesSingletonSyncRoot())
        // Node.js is single-threaded for this part of the code, so direct synchronization isn't the same.
        // The critical part is ensuring `jicofoServicesInstance` is created and set before other things might try to access it.
        jicofoServicesInstance = new JicofoServices();
        setJicofoServicesSingleton(jicofoServicesInstance);
        jicofoServicesInstance.start(); // Explicit start call if needed
    } catch (e) {
        logger.error('Failed to start JicofoServices:', e);
        shutdownTaskPools(); // Call placeholder for task pool shutdown
        // In a real scenario, ensure any partially initialized resources are cleaned up.
        process.exit(1); // Exit if services fail to start
    }

    // Graceful shutdown handling
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) {
            logger.warn('Already shutting down...');
            return;
        }
        shuttingDown = true;
        logger.info(`Received ${signal}. Stopping services...`);

        if (jicofoServicesInstance) {
            try {
                await jicofoServicesInstance.shutdown(); // Assuming shutdown can be async
            } catch (e) {
                logger.error('Error during JicofoServices shutdown:', e);
            }
        }

        shutdownTaskPools(); // Call placeholder for task pool shutdown
        setJicofoServicesSingleton(null);

        logger.info('Jicofo-Node shutdown complete.');
        process.exit(0); // Exit after cleanup
    };

    process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C
    process.on('SIGTERM', () => shutdown('SIGTERM')); // Termination signal

    logger.info('Jicofo-Node started successfully. Awaiting shutdown signal...');

    // Keep the process alive until a shutdown signal is received.
    // In Java, this was done with `shutdownLatch.await();`.
    // In Node.js, if there are active listeners/timers (e.g., server, XMPP client),
    // the process will stay alive. If not, it might exit.
    // For a long-running service, ensure something keeps the event loop busy,
    // or use a more explicit way to keep it alive if needed (though often not necessary).
    // Example: setInterval(() => {}, 1000 * 60 * 60); // Keep alive if nothing else does
}

// Run the main function
main().catch(error => {
    logger.error("Critical error during Jicofo-Node startup:", error);
    process.exit(1);
});
