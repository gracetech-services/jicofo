const { expect } = require('chai');
const proxyquire = require('proxyquire');
const { createElement } = require('@xmpp/xml');

// Mock XMPP connection
const mockXmppConnection = {
    xmpp: {
        status: 'online',
        send: async () => {}
    },
    config: {
        domain: 'test.example.com'
    }
};

// Mock logger
const mockLogger = {
    child: () => ({
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {}
    })
};

describe('ComponentDiscovery', () => {
    let ComponentDiscovery;
    let componentDiscovery;

    beforeEach(() => {
        // Reset the mock XMPP connection
        mockXmppConnection.xmpp.status = 'online';
        
        // Mock the XMPP connection send method to return disco#info responses
        mockXmppConnection.xmpp.send = async (iq) => {
            const to = iq.attrs.to;
            const query = iq.getChild('query');
            
            if (query && query.attrs.xmlns === 'http://jabber.org/protocol/disco#info') {
                if (to === 'test.example.com') {
                    // Return components for domain discovery
                    return createElement('iq', { type: 'result', id: iq.attrs.id }, [
                        createElement('query', { xmlns: 'http://jabber.org/protocol/disco#info' }, [
                            createElement('identity', { 
                                category: 'component', 
                                type: 'jitsi-videobridge', 
                                name: 'jvb1.test.example.com' 
                            }),
                            createElement('identity', { 
                                category: 'component', 
                                type: 'jitsi-videobridge', 
                                name: 'jvb2.test.example.com' 
                            }),
                            createElement('identity', { 
                                category: 'server', 
                                type: 'im', 
                                name: 'server.test.example.com' 
                            })
                        ])
                    ]);
                } else if (to === 'jvb1.test.example.com') {
                    // Return JVB features
                    return createElement('iq', { type: 'result', id: iq.attrs.id }, [
                        createElement('query', { xmlns: 'http://jabber.org/protocol/disco#info' }, [
                            createElement('feature', { var: 'urn:xmpp:rayo:0' }),
                            createElement('feature', { var: 'http://jitsi.org/protocol/colibri' }),
                            createElement('feature', { var: 'http://jitsi.org/protocol/jitsi-videobridge' })
                        ])
                    ]);
                } else if (to === 'server.test.example.com') {
                    // Return non-JVB features
                    return createElement('iq', { type: 'result', id: iq.attrs.id }, [
                        createElement('query', { xmlns: 'http://jabber.org/protocol/disco#info' }, [
                            createElement('feature', { var: 'http://jabber.org/protocol/disco#info' }),
                            createElement('feature', { var: 'http://jabber.org/protocol/disco#items' })
                        ])
                    ]);
                }
            }
            
            // Default error response
            return createElement('iq', { type: 'error', id: iq.attrs.id }, [
                createElement('error', { type: 'cancel' }, [
                    createElement('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                ])
            ]);
        };

        ComponentDiscovery = proxyquire('../../src/xmpp/componentDiscovery', {
            '../utils/logger': mockLogger
        }).ComponentDiscovery;

        componentDiscovery = new ComponentDiscovery(mockXmppConnection);
    });

    describe('discoverComponents', () => {
        it('should discover components for a domain', async () => {
            const components = await componentDiscovery.discoverComponents('test.example.com');
            
            expect(components).to.be.instanceOf(Set);
            expect(components.size).to.equal(2);
            
            const componentArray = Array.from(components);
            expect(componentArray[0].type).to.equal('jitsi-videobridge');
            expect(componentArray[0].address).to.equal('jvb1.test.example.com');
            expect(componentArray[1].type).to.equal('jitsi-videobridge');
            expect(componentArray[1].address).to.equal('jvb2.test.example.com');
        });

        it('should handle connection not online', async () => {
            mockXmppConnection.xmpp.status = 'offline';
            
            const components = await componentDiscovery.discoverComponents('test.example.com');
            
            expect(components).to.be.instanceOf(Set);
            expect(components.size).to.equal(0);
        });

        it('should handle error responses', async () => {
            mockXmppConnection.xmpp.send = async () => {
                return createElement('iq', { type: 'error', id: 'test' }, [
                    createElement('error', { type: 'cancel' }, [
                        createElement('service-unavailable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })
                    ])
                ]);
            };

            const components = await componentDiscovery.discoverComponents('test.example.com');
            
            expect(components).to.be.instanceOf(Set);
            expect(components.size).to.equal(0);
        });
    });

    describe('discoverFeatures', () => {
        it('should discover features for a JID', async () => {
            const features = await componentDiscovery.discoverFeatures('jvb1.test.example.com');
            
            expect(features).to.be.instanceOf(Set);
            expect(features.size).to.equal(3);
            expect(features.has('urn:xmpp:rayo:0')).to.be.true;
            expect(features.has('http://jitsi.org/protocol/colibri')).to.be.true;
            expect(features.has('http://jitsi.org/protocol/jitsi-videobridge')).to.be.true;
        });

        it('should handle connection not online', async () => {
            mockXmppConnection.xmpp.status = 'offline';
            
            const features = await componentDiscovery.discoverFeatures('jvb1.test.example.com');
            
            expect(features).to.be.instanceOf(Set);
            expect(features.size).to.equal(0);
        });
    });

    describe('isJvbComponent', () => {
        it('should identify JVB components correctly', async () => {
            const isJvb = await componentDiscovery.isJvbComponent('jvb1.test.example.com');
            expect(isJvb).to.be.true;
        });

        it('should identify non-JVB components correctly', async () => {
            const isJvb = await componentDiscovery.isJvbComponent('server.test.example.com');
            expect(isJvb).to.be.false;
        });
    });

    describe('listeners', () => {
        it('should add and remove listeners', () => {
            const listener = {
                componentsChanged: () => {}
            };

            componentDiscovery.addListener(listener);
            expect(componentDiscovery.listeners).to.include(listener);

            componentDiscovery.removeListener(listener);
            expect(componentDiscovery.listeners).to.not.include(listener);
        });

        it('should fire components changed event', async () => {
            let componentsChangedCalled = false;
            let componentsChangedWith = null;

            const listener = {
                componentsChanged: (components) => {
                    componentsChangedCalled = true;
                    componentsChangedWith = components;
                }
            };

            componentDiscovery.addListener(listener);
            await componentDiscovery.discoverComponents('test.example.com');

            expect(componentsChangedCalled).to.be.true;
            expect(componentsChangedWith).to.be.instanceOf(Set);
            expect(componentsChangedWith.size).to.equal(2);
        });
    });

    describe('getComponents', () => {
        it('should return current components', async () => {
            await componentDiscovery.discoverComponents('test.example.com');
            
            const components = componentDiscovery.getComponents();
            expect(components).to.be.instanceOf(Set);
            expect(components.size).to.equal(2);
        });
    });
}); 