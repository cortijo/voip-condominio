package br.com.interfone.virtual

import android.app.Application

class InterfoneApp : Application() {
    override fun onCreate() {
        super.onCreate()
        SipManager.init(this)
        SipManager.register(Store(this).loadSip())
    }
}
