package br.com.interfone.virtual

import android.content.Context

const val DEFAULT_SERVER = "http://45.224.165.42:9670"

/** Preferências locais: dados de login, última configuração (uso offline) e cursores de avisos/chat. */
class Store(context: Context) {
    private val sp = context.getSharedPreferences("interfone_v2", Context.MODE_PRIVATE)

    private fun str(key: String, def: String = "") = sp.getString(key, def) ?: def

    var server: String
        get() = str("server", DEFAULT_SERVER)
        set(v) { sp.edit().putString("server", v).apply() }
    var code: String
        get() = str("code")
        set(v) { sp.edit().putString("code", v).apply() }
    var username: String
        get() = str("username")
        set(v) { sp.edit().putString("username", v).apply() }
    var token: String
        get() = str("token")
        set(v) { sp.edit().putString("token", v).apply() }
    var configJson: String
        get() = str("config")
        set(v) { sp.edit().putString("config", v).apply() }
    var noticeCursor: Long
        get() = sp.getLong("n_cursor", 0)
        set(v) { sp.edit().putLong("n_cursor", v).apply() }
    var chatCursor: Long
        get() = sp.getLong("m_cursor", 0)
        set(v) { sp.edit().putLong("m_cursor", v).apply() }

    /** Apaga a sessão (mantém servidor, código e usuário para facilitar o próximo login). */
    fun clearSession() {
        sp.edit().remove("token").remove("config").remove("n_cursor").remove("m_cursor").apply()
    }
}
