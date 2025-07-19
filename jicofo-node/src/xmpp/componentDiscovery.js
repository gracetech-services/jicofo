const logger = require('../utils/logger');
const { createElement } = require('@xmpp/xml');

/**
 * Component discovery functionality for finding JVB instances and other XMPP components.
 * Migrated from Java XmppProvider's discoverComponents method.
 */
class ComponentDiscovery {
    constructor(xmppConnection) {
        this.xmppConnection = xmppConnection;
        this.logger = logger.child({ component: 'ComponentDiscovery' });
        this.components = new Set();
        this.listeners = [];
    }

    /**
     * Add a listener for component changes.
     * @param {object} listener - Object with componentsChanged(components) method
     */
    addListener(listener) {
        this.listeners.push(listener);
    }

    /**
     * Remove a listener.
     * @param {object} listener - The listener to remove
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * Discover components for a given domain.
     * @param {string} domain - The domain to discover components for
     * @returns {Promise<Set<Component>>} - Set of discovered components
     */
    async discoverComponents(domain) {
        if (!this.xmppConnection.xmpp || this.xmppConnection.xmpp.status !== 'online') {
            this.logger.error('Cannot discover components, not connected.');
            return new Set();
        }

        this.logger.info(`Discovering components for domain: ${domain}`);

        try {
            // Send disco#info query to the domain
            const iq = createElement('iq', {
                type: 'get',
                to: domain,
                id: `disco-${Date.now()}`
            }, [
                createElement('query', { xmlns: 'http://jabber.org/protocol/disco#info' })
            ]);

            const response = await this.xmppConnection.xmpp.send(iq);
            
            if (!response || response.attrs.type === 'error') {
                this.logger.warn(`Failed to discover components for ${domain}: ${response?.getChild('error')?.toString() || 'No response'}`);
                return new Set();
            }

            const query = response.getChild('query');
            if (!query) {
                this.logger.warn(`No query element in disco#info response from ${domain}`);
                return new Set();
            }

            const identities = query.getChildren('identity');
            const components = new Set();

            for (const identity of identities) {
                const category = identity.attrs.category;
                const type = identity.attrs.type;
                const name = identity.attrs.name;

                if (category === 'component') {
                    const component = new Component(type, name);
                    components.add(component);
                    this.logger.info(`Discovered component: ${component.type} - ${component.address}`);
                }
            }

            this.logger.info(`Discovered ${components.size} components for domain ${domain}`);
            this.components = components;
            this._fireComponentsChanged(components);
            
            return components;

        } catch (error) {
            this.logger.error(`Failed to discover components for ${domain}:`, error);
            return new Set();
        }
    }

    /**
     * Discover features for a specific JID.
     * @param {string} jid - The JID to discover features for
     * @returns {Promise<Set<string>>} - Set of feature strings
     */
    async discoverFeatures(jid) {
        if (!this.xmppConnection.xmpp || this.xmppConnection.xmpp.status !== 'online') {
            this.logger.error('Cannot discover features, not connected.');
            return new Set();
        }

        this.logger.debug(`Discovering features for JID: ${jid}`);

        try {
            const iq = createElement('iq', {
                type: 'get',
                to: jid,
                id: `disco-features-${Date.now()}`
            }, [
                createElement('query', { xmlns: 'http://jabber.org/protocol/disco#info' })
            ]);

            const response = await this.xmppConnection.xmpp.send(iq);
            
            if (!response || response.attrs.type === 'error') {
                this.logger.debug(`Failed to discover features for ${jid}: ${response?.getChild('error')?.toString() || 'No response'}`);
                return new Set();
            }

            const query = response.getChild('query');
            if (!query) {
                this.logger.debug(`No query element in disco#info response from ${jid}`);
                return new Set();
            }

            const features = query.getChildren('feature');
            const featureStrings = new Set();

            for (const feature of features) {
                const var_ = feature.attrs.var;
                if (var_) {
                    featureStrings.add(var_);
                }
            }

            this.logger.debug(`Discovered ${featureStrings.size} features for ${jid}`);
            return featureStrings;

        } catch (error) {
            this.logger.warn(`Failed to discover features for ${jid}:`, error);
            return new Set();
        }
    }

    /**
     * Get the current set of discovered components.
     * @returns {Set<Component>} - Current components
     */
    getComponents() {
        return new Set(this.components);
    }

    /**
     * Check if a component is a JVB based on its features.
     * @param {string} jid - The JID to check
     * @returns {Promise<boolean>} - True if the component is a JVB
     */
    async isJvbComponent(jid) {
        const features = await this.discoverFeatures(jid);
        
        // JVB typically advertises these features
        const jvbFeatures = [
            'urn:xmpp:rayo:0',           // Rayo protocol
            'http://jitsi.org/protocol/colibri', // Colibri protocol
            'http://jitsi.org/protocol/jitsi-videobridge', // JVB protocol
            'urn:xmpp:octo:1'            // Octo protocol
        ];

        return jvbFeatures.some(feature => features.has(feature));
    }

    /**
     * Fire components changed event to all listeners.
     * @param {Set<Component>} components - The new set of components
     * @private
     */
    _fireComponentsChanged(components) {
        for (const listener of this.listeners) {
            try {
                if (typeof listener.componentsChanged === 'function') {
                    listener.componentsChanged(components);
                }
            } catch (error) {
                this.logger.error('Error in componentsChanged listener:', error);
            }
        }
    }
}

/**
 * Represents a discovered XMPP component.
 */
class Component {
    constructor(type, address) {
        this.type = type;
        this.address = address;
    }

    toString() {
        return `Component[type=${this.type}, address=${this.address}]`;
    }
}

module.exports = { ComponentDiscovery, Component }; 