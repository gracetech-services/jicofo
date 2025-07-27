const logger = require('../../utils/logger');
const Bridge = require('./bridge');

/**
 * Detects JVB instances through component discovery.
 * Migrated from Java BridgeMucDetector but uses component discovery instead of MUC.
 */
class BridgeComponentDetector {
    /**
     * @param {ManagedXmppConnection} xmppConnection - The XMPP connection to use for discovery
     * @param {BridgeSelector} bridgeSelector - The BridgeSelector instance to update
     * @param {string} domain - The domain to discover components for
     */
    constructor(xmppConnection, bridgeSelector, domain) {
        this.xmppConnection = xmppConnection;
        this.bridgeSelector = bridgeSelector;
        this.domain = domain;
        this.logger = logger.child({ component: 'BridgeComponentDetector', domain });
        
        this.isRunning = false;
        this.discoveryInterval = null;
        this.discoveredJvbs = new Set(); // Track discovered JVB JIDs
    }

    /**
     * Start the bridge detection process.
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn('BridgeComponentDetector is already running.');
            return;
        }

        this.logger.info(`Starting bridge component detection for domain: ${this.domain}`);
        this.isRunning = true;

        // Perform initial discovery
        await this._discoverJvbs();

        // Set up periodic discovery (every 30 seconds)
        this.discoveryInterval = setInterval(async () => {
            if (this.isRunning) {
                await this._discoverJvbs();
            }
        }, 30000);

        this.logger.info('BridgeComponentDetector started successfully.');
    }

    /**
     * Stop the bridge detection process.
     */
    stop() {
        if (!this.isRunning) {
            this.logger.warn('BridgeComponentDetector is not running.');
            return;
        }

        this.logger.info('Stopping bridge component detection.');
        this.isRunning = false;

        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
            this.discoveryInterval = null;
        }

        this.logger.info('BridgeComponentDetector stopped.');
    }

    /**
     * Discover JVB components and update the bridge selector.
     * @private
     */
    async _discoverJvbs() {
        try {
            this.logger.debug(`Discovering components for domain: ${this.domain}`);
            
            const components = await this.xmppConnection.discoverComponents(this.domain);
            const currentJvbs = new Set();

            for (const component of components) {
                // Check if this component is a JVB
                const isJvb = await this.xmppConnection.isJvbComponent(component.address);
                
                if (isJvb) {
                    currentJvbs.add(component.address);
                    
                    // Check if this is a new JVB
                    if (!this.discoveredJvbs.has(component.address)) {
                        this.logger.info(`New JVB discovered: ${component.address} (type: ${component.type})`);
                        this._addJvbToSelector(component.address, component.type);
                        this.discoveredJvbs.add(component.address);
                    }
                }
            }

            // Check for JVBs that are no longer available
            for (const jvbJid of this.discoveredJvbs) {
                if (!currentJvbs.has(jvbJid)) {
                    this.logger.info(`JVB no longer available: ${jvbJid}`);
                    this._removeJvbFromSelector(jvbJid);
                    this.discoveredJvbs.delete(jvbJid);
                }
            }

            this.logger.debug(`Bridge discovery complete. Current JVBs: ${Array.from(currentJvbs).join(', ')}`);

        } catch (error) {
            this.logger.error('Error during bridge discovery:', error);
        }
    }

    /**
     * Add a JVB to the bridge selector.
     * @param {string} jvbJid - The JID of the JVB
     * @param {string} componentType - The component type
     * @private
     */
    _addJvbToSelector(jvbJid, componentType) {
        try {
            // Create a new Bridge instance
            const bridge = new Bridge(jvbJid);
            
            // Set component type as additional info
            bridge.componentType = componentType;
            
            // Add to bridge selector
            this.bridgeSelector.addBridge(bridge);
            
            this.logger.info(`Added JVB to selector: ${jvbJid} (type: ${componentType})`);
            
        } catch (error) {
            this.logger.error(`Error adding JVB ${jvbJid} to selector:`, error);
        }
    }

    /**
     * Remove a JVB from the bridge selector.
     * @param {string} jvbJid - The JID of the JVB
     * @private
     */
    _removeJvbFromSelector(jvbJid) {
        try {
            // Remove from bridge selector
            this.bridgeSelector.removeBridge(jvbJid);
            
            this.logger.info(`Removed JVB from selector: ${jvbJid}`);
            
        } catch (error) {
            this.logger.error(`Error removing JVB ${jvbJid} from selector:`, error);
        }
    }

    /**
     * Get the current list of discovered JVB JIDs.
     * @returns {Set<string>} - Set of JVB JIDs
     */
    getDiscoveredJvbs() {
        return new Set(this.discoveredJvbs);
    }

    /**
     * Get debug information about the detector.
     * @returns {object} - Debug state
     */
    getDebugState() {
        return {
            isRunning: this.isRunning,
            domain: this.domain,
            discoveredJvbs: Array.from(this.discoveredJvbs),
            totalDiscovered: this.discoveredJvbs.size
        };
    }
}

module.exports = BridgeComponentDetector; 