package br.com.interfone.virtual

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.linphone.core.Account
import org.linphone.core.AudioDevice
import org.linphone.core.Call
import org.linphone.core.Core
import org.linphone.core.CoreListenerStub
import org.linphone.core.Factory
import org.linphone.core.Reason
import org.linphone.core.RegistrationState
import org.linphone.core.TransportType

/** Camada SIP/VoIP sobre o Linphone SDK. Estados observáveis pelo Compose. */
object SipManager {

    enum class CallStatus { NONE, OUTGOING, INCOMING, CONNECTED }

    var registration by mutableStateOf("Não configurado")
    var registered by mutableStateOf(false)
    var callStatus by mutableStateOf(CallStatus.NONE)
    var peer by mutableStateOf("")
    var micMuted by mutableStateOf(false)
    var speakerOn by mutableStateOf(false)

    private var core: Core? = null
    private var current: Call? = null
    private var domain: String = ""

    private val listener = object : CoreListenerStub() {
        override fun onAccountRegistrationStateChanged(
            core: Core, account: Account, state: RegistrationState?, message: String
        ) {
            when (state) {
                RegistrationState.Ok -> { registered = true; registration = "Conectado" }
                RegistrationState.Progress -> { registered = false; registration = "Conectando…" }
                RegistrationState.Failed -> { registered = false; registration = "Falha no registro: $message" }
                RegistrationState.Cleared, RegistrationState.None -> {
                    registered = false; registration = "Desconectado"
                }
                else -> {}
            }
        }

        override fun onCallStateChanged(core: Core, call: Call, state: Call.State?, message: String) {
            when (state) {
                Call.State.IncomingReceived -> {
                    current = call
                    peer = call.remoteAddress.displayName ?: call.remoteAddress.username ?: "Chamada"
                    callStatus = CallStatus.INCOMING
                }
                Call.State.OutgoingInit,
                Call.State.OutgoingProgress,
                Call.State.OutgoingRinging,
                Call.State.OutgoingEarlyMedia -> {
                    current = call
                    callStatus = CallStatus.OUTGOING
                }
                Call.State.Connected, Call.State.StreamsRunning -> callStatus = CallStatus.CONNECTED
                Call.State.End, Call.State.Error, Call.State.Released -> {
                    if (call == current || current == null) resetCall()
                }
                else -> {}
            }
        }
    }

    fun init(context: Context) {
        if (core != null) return
        val factory = Factory.instance()
        factory.setDebugMode(false, "Interfone")
        val c = factory.createCore(null, null, context.applicationContext)
        c.addListener(listener)
        c.start()
        core = c
    }

    fun register(cfg: SipConfig) {
        val c = core ?: return
        c.clearAccounts()
        c.clearAllAuthInfo()
        if (!cfg.isComplete) {
            registered = false
            registration = "Não configurado"
            return
        }
        domain = cfg.domain
        val factory = Factory.instance()
        val auth = factory.createAuthInfo(cfg.user, null, cfg.password, null, null, cfg.domain)
        c.addAuthInfo(auth)

        val params = c.createAccountParams()
        params.identityAddress = factory.createAddress("sip:${cfg.user}@${cfg.domain}")
        val server = factory.createAddress("sip:${cfg.domain}:${cfg.port}")
        server?.transport = TransportType.Udp
        params.serverAddress = server

        val account = c.createAccount(params)
        c.addAccount(account)
        c.defaultAccount = account
        registration = "Conectando…"
    }

    /** Liga para um ramal. Retorna false se não estiver registrado. */
    fun call(ext: String, label: String): Boolean {
        val c = core ?: return false
        if (!registered || ext.isBlank()) return false
        peer = label
        micMuted = false
        c.isMicEnabled = true
        val call = c.invite("sip:$ext@$domain") ?: return false
        current = call
        callStatus = CallStatus.OUTGOING
        return true
    }

    fun answer() { current?.accept() }

    fun hangUp() {
        val call = current ?: core?.currentCall
        if (call == null) { resetCall(); return }
        if (callStatus == CallStatus.INCOMING) call.decline(Reason.Declined) else call.terminate()
    }

    fun toggleMute() {
        val c = core ?: return
        micMuted = !micMuted
        c.isMicEnabled = !micMuted
    }

    fun toggleSpeaker() {
        val c = core ?: return
        speakerOn = !speakerOn
        val type = if (speakerOn) AudioDevice.Type.Speaker else AudioDevice.Type.Earpiece
        val device = c.audioDevices.firstOrNull { it.type == type } ?: return
        (current ?: c.currentCall)?.outputAudioDevice = device
    }

    private fun resetCall() {
        current = null
        callStatus = CallStatus.NONE
        micMuted = false
        speakerOn = false
        core?.isMicEnabled = true
    }
}
