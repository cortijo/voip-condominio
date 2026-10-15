package br.com.interfone.virtual

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import br.com.interfone.virtual.ui.Brand
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Fonte única de verdade do app: sessão, configuração aprovisionada, avisos e chat.
 * É consultada tanto pela interface quanto pelo serviço em segundo plano.
 */
object Repo {
    private lateinit var ctx: Context
    private lateinit var store: Store
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var loggedIn by mutableStateOf(false)
    var config by mutableStateOf<Provisioned?>(null)
    var logo by mutableStateOf<ImageBitmap?>(null)
    var syncStatus by mutableStateOf("")
    var unreadNotices by mutableIntStateOf(0)
    var unreadChat by mutableIntStateOf(0)
    val notices = mutableStateListOf<Notice>()      // mais recentes primeiro
    val chat = mutableStateListOf<ChatMessage>()    // mais antigas primeiro

    /** Definido pela MainActivity: usado para decidir se notifica e para pedir permissão de microfone. */
    @Volatile var appInForeground = false
    var requestMic: (() -> Unit)? = null

    private var lastVersion = ""
    private var lastLogoUrl: String? = null
    private var noticeCursor = 0L
    private var chatCursor = 0L

    val savedServer get() = store.server
    val savedCode get() = store.code
    val savedUsername get() = store.username

    fun init(context: Context) {
        if (::ctx.isInitialized) return
        ctx = context.applicationContext
        store = Store(ctx)
        Notifier.ensureChannels(ctx)
        SipManager.init(ctx)
        if (store.token.isNotBlank() && store.configJson.isNotBlank()) {
            try {
                noticeCursor = store.noticeCursor
                chatCursor = store.chatCursor
                applyConfig(Api.parseConfig(store.configJson))
                loggedIn = true
                scope.launch { refreshAll() }
            } catch (e: Exception) {
                store.clearSession()
            }
        }
    }

    fun labelFor(number: String?): String? =
        if (number == null) null else config?.extensions?.firstOrNull { it.number == number }?.title

    // ------------------------------------------------------------------ sessão

    suspend fun login(server: String, code: String, user: String, pass: String) {
        val srv = Api.normalizeServer(server)
        val (token, cfgJson) = withContext(Dispatchers.IO) { Api.login(srv, code.trim(), user.trim(), pass) }
        val parsed = Api.parseConfig(cfgJson)
        store.server = srv
        store.code = code.trim()
        store.username = user.trim()
        store.token = token
        store.configJson = cfgJson
        noticeCursor = 0; chatCursor = 0
        store.noticeCursor = 0; store.chatCursor = 0
        notices.clear(); chat.clear()
        unreadNotices = 0; unreadChat = 0
        lastVersion = ""
        applyConfig(parsed)
        loggedIn = true
        refreshLists(silent = true)
    }

    fun logout() {
        val srv = store.server
        val tk = store.token
        if (tk.isNotBlank()) scope.launch(Dispatchers.IO) { Api.logout(srv, tk) }
        endSession()
    }

    private fun endSession() {
        store.clearSession()
        loggedIn = false
        config = null
        logo = null
        lastVersion = ""
        lastLogoUrl = null
        notices.clear(); chat.clear()
        unreadNotices = 0; unreadChat = 0
        Brand.apply(BrandColors())
        SipManager.register(SipConfig())
        try { ctx.stopService(Intent(ctx, SyncService::class.java)) } catch (e: Exception) { /* ignora */ }
    }

    // ------------------------------------------------------------------ sincronização

    private fun applyConfig(p: Provisioned) {
        config = p
        Brand.apply(p.colors)
        if (p.logoUrl != lastLogoUrl) {
            lastLogoUrl = p.logoUrl
            logo = null
            val url = p.logoUrl
            if (url != null) {
                val full = store.server + url
                scope.launch {
                    val bmp = withContext(Dispatchers.IO) {
                        Api.fetchBytes(full)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                    }
                    if (lastLogoUrl == url) logo = bmp?.asImageBitmap()
                }
            }
        }
        if (p.version != lastVersion) {
            lastVersion = p.version
            SipManager.register(p.sip ?: SipConfig())
        }
    }

    private fun handleAuthError(e: ApiException): Boolean {
        if (e.code == 401) { endSession(); return true }
        return false
    }

    /** Busca configuração, avisos e conversa. */
    suspend fun refreshAll(): Boolean {
        val srv = store.server
        val tk = store.token
        if (tk.isBlank()) return false
        return try {
            val cfgJson = withContext(Dispatchers.IO) { Api.configJson(srv, tk) }
            store.configJson = cfgJson
            applyConfig(Api.parseConfig(cfgJson))
            refreshLists(silent = false)
            syncStatus = ""
            true
        } catch (e: ApiException) {
            if (!handleAuthError(e)) syncStatus = e.message ?: "Falha ao sincronizar"
            false
        } catch (e: Exception) {
            syncStatus = "Falha ao sincronizar"
            false
        }
    }

    private suspend fun refreshLists(silent: Boolean) {
        val srv = store.server
        val tk = store.token
        val (ns, ms) = withContext(Dispatchers.IO) { Api.notices(srv, tk) to Api.chat(srv, tk) }
        // avisos: lista completa (mais recentes primeiro)
        val freshN = ns.filter { it.id > noticeCursor }
        notices.clear(); notices.addAll(ns.sortedByDescending { it.id })
        if (!silent) freshN.sortedBy { it.id }.forEach { onNewNotice(it) }
        noticeCursor = maxOf(noticeCursor, ns.maxOfOrNull { it.id } ?: 0)
        // chat
        val freshM = ms.filter { it.id > chatCursor && it.fromOperator }
        chat.clear(); chat.addAll(ms.sortedBy { it.id })
        if (!silent) freshM.sortedBy { it.id }.forEach { onNewOperatorMessage(it) }
        chatCursor = maxOf(chatCursor, ms.maxOfOrNull { it.id } ?: 0)
        store.noticeCursor = noticeCursor
        store.chatCursor = chatCursor
    }

    /** Chamada periódica (serviço em segundo plano): traz só o que é novo. */
    suspend fun poll() {
        val srv = store.server
        val tk = store.token
        if (!loggedIn || tk.isBlank()) return
        try {
            val r = withContext(Dispatchers.IO) { Api.poll(srv, tk, noticeCursor, chatCursor) }
            syncStatus = ""
            if (r.version != lastVersion) {
                val cfgJson = withContext(Dispatchers.IO) { Api.configJson(srv, tk) }
                store.configJson = cfgJson
                applyConfig(Api.parseConfig(cfgJson))
            }
            for (n in r.notices) {
                if (notices.none { it.id == n.id }) { notices.add(0, n); onNewNotice(n) }
                noticeCursor = maxOf(noticeCursor, n.id)
            }
            for (m in r.messages) {
                if (chat.none { it.id == m.id }) {
                    chat.add(m)
                    if (m.fromOperator) onNewOperatorMessage(m)
                }
                chatCursor = maxOf(chatCursor, m.id)
            }
            store.noticeCursor = noticeCursor
            store.chatCursor = chatCursor
        } catch (e: ApiException) {
            if (!handleAuthError(e)) syncStatus = e.message ?: "Sem conexão"
        } catch (e: Exception) {
            syncStatus = "Sem conexão"
        }
    }

    suspend fun sendChat(text: String) {
        val srv = store.server
        val tk = store.token
        withContext(Dispatchers.IO) { Api.sendChat(srv, tk, text) }
        poll()
    }

    // ------------------------------------------------------------------ eventos

    private fun onNewNotice(n: Notice) {
        unreadNotices++
        if (!appInForeground) Notifier.notice(ctx, n)
    }

    private fun onNewOperatorMessage(m: ChatMessage) {
        unreadChat++
        if (!appInForeground) Notifier.chat(ctx, m)
    }

    fun markNoticesSeen() { unreadNotices = 0 }
    fun markChatSeen() { unreadChat = 0 }
}
