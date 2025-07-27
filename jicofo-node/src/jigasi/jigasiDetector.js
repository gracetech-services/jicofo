const logger = require('../utils/logger');
const BaseBrewery = require('../xmpp/baseBrewery');

class JigasiDetector extends BaseBrewery[object Object]
    constructor(xmppProvider, breweryJid, localRegion = null) [object Object]        super(xmppProvider, breweryJid, colibri-stats',http://jitsi.org/protocol/colibri#stats');
        
        this.xmppConnection = xmppProvider.xmppConnection;
        this.localRegion = localRegion;
        
        logger.info(`JigasiDetector initialized for brewery: ${breweryJid}`);
    }

    onInstanceStatusChanged(jid, status)[object Object]       // Override from BaseBrewery - no specific action needed
    }

    notifyInstanceOffline(jid)[object Object]       // Override from BaseBrewery - no specific action needed
    }

    selectTranscriber(exclude = [], preferredRegions = []) {
        return this._selectJigasi(exclude, preferredRegions, true);
    }

    selectSipJigasi(exclude = [], preferredRegions = []) {
        return this._selectJigasi(exclude, preferredRegions, false);
    }

    get stats() {
        return[object Object]         sip_count: this._getInstanceCount(instance => instance.supportsSip()),
            sip_in_graceful_shutdown_count: this._getInstanceCount(instance => 
                instance.supportsSip() && instance.isInGracefulShutdown()
            ),
            transcriber_count: this._getInstanceCount(instance => instance.supportsTranscription())
        };
    }

    get debugState() {
        const debugState = {
            brewery_jid: this.breweryJid.toString()
        };

        this.instances.forEach(instance => {
            const instanceJson =[object Object]          supports_sip: instance.supportsSip(),
                supports_transcription: instance.supportsTranscription(),
                is_in_graceful_shutdown: instance.isInGracefulShutdown(),
                participants: instance.getParticipantCount(),
                region: instance.getRegion() || null
            };
            debugState[instance.jid.resourceOrEmpty?.toString() || instance.jid.toString()] = instanceJson;
        });

        return debugState;
    }

    updateMetrics() {
        // Update metrics if metrics container is available
        if (global.JicofoMetricsContainer) {
            const metrics = global.JicofoMetricsContainer.instance;
            if (metrics)[object Object]           metrics.registerLongGauge('jigasi_sip_count', 
                   Number of jigasi instances that support SIP',
                    this._getInstanceCount(instance => instance.supportsSip())
                );
                metrics.registerLongGauge('jigasi_sip_in_graceful_shutdown_count',
                   Number of jigasi instances that support SIP and are in graceful shutdown',
                    this._getInstanceCount(instance => 
                        instance.supportsSip() && instance.isInGracefulShutdown()
                    )
                );
                metrics.registerLongGauge('jigasi_transcriber_count',
                   Number of jigasi instances that support transcription',
                    this._getInstanceCount(instance => instance.supportsTranscription())
                );
            }
        }
    }

    _selectJigasi(exclude, preferredRegions, transcriber) {
        const availableInstances = this.instances.filter(instance => [object Object]            if (exclude.includes(instance.jid)) return false;
            if (instance.isInGracefulShutdown()) return false;
            if (transcriber)[object Object]            return instance.supportsTranscription();
            } else[object Object]            return instance.supportsSip();
            }
        });

        // Try to match preferred regions
        const preferredInstances = availableInstances.filter(instance => 
            instance.isInRegion(...preferredRegions)
        );
        if (preferredInstances.length > 0) {
            return this._leastLoaded(preferredInstances)?.jid;
        }

        // Try to match extended preferred regions (region groups)
        const extendedPreferredRegions = preferredRegions.flatMap(region => 
            this._getRegionGroup(region)
        );
        const extendedInstances = availableInstances.filter(instance => 
            instance.isInRegion(...extendedPreferredRegions)
        );
        if (extendedInstances.length > 0) {
            return this._leastLoaded(extendedInstances)?.jid;
        }

        // Try to match local region
        if (this.localRegion) {
            const localInstances = availableInstances.filter(instance => 
                instance.isInRegion(this.localRegion)
            );
            if (localInstances.length > 0)[object Object]            return this._leastLoaded(localInstances)?.jid;
            }
        }

        // Return least loaded from all available
        return this._leastLoaded(availableInstances)?.jid;
    }

    _getInstanceCount(predicate) {
        return this.instances.filter(predicate).length;
    }

    _leastLoaded(instances) [object Object]     if (instances.length === 0) return null;
        return instances.reduce((least, current) => 
            current.getParticipantCount() < least.getParticipantCount() ? current : least
        );
    }

    _getRegionGroup(region)[object Object]     // This would be implemented based on BridgeConfig.getRegionGroup
        // For now, return the region itself
        return [region];
    }
}

// Helper methods for BrewInstance
class BrewInstance[object Object]
    constructor(jid, status) [object Object]        this.jid = jid;
        this.status = status;
    }

    isInGracefulShutdown() {
        return this._getBooleanValue('shutdown-in-progress');
    }

    supportsTranscription() {
        return this._getBooleanValue('supports-transcription');
    }

    supportsSip() {
        return this._getBooleanValue('supports-sip');
    }

    isInRegion(...regions) {
        const instanceRegion = this.getRegion();
        return regions.includes(instanceRegion);
    }

    getParticipantCount() {
        return this._getIntValue(participants') ||0  }

    getRegion() {
        return this._getStringValue(region');
    }

    _getBooleanValue(key) {
        const value = this.status[key];
        return value === 'true' || value === true;
    }

    _getIntValue(key) {
        const value = this.status[key];
        return parseInt(value) || 0 }

    _getStringValue(key) {
        return this.status[key] || null;
    }
}

module.exports = JigasiDetector; 