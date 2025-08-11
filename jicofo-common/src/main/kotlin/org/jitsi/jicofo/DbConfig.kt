package org.jitsi.jicofo

import org.jitsi.config.JitsiConfig.Companion.newConfig
import org.jitsi.metaconfig.config

class DbConfig private constructor() {



    val dbUrl: String by config {
        "jicofo.db.url".from(newConfig)
    }
    val password: String by config {
        "jicofo.db.password".from(newConfig)
    }
    val usrName: String by config {
        "jicofo.db.username".from(newConfig)
    }
    val maxPoolSize : Int by config {
        "jicofo.db.max-pool-size".from(newConfig)
    }
    val minPoolSize : Int by config {
        "jicofo.db.min-pool-size".from(newConfig)
    }
    val minIdle : Int by config {
        "jicofo.db.min-idle".from(newConfig)
    }
    val connectionTimeout : Long by config {
        "jicofo.db.connection-timeout".from(newConfig)
    }
    val idleTimeout : Long by config {
        "jicofo.db.idle-timeout".from(newConfig)
    }
    val maxLifetime : Long by config {
        "jicofo.db.max-lifetime".from(newConfig)
    }

    companion object {

        @JvmField
        val config = DbConfig()
    }
}