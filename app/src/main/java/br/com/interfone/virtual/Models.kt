package br.com.interfone.virtual

import androidx.compose.ui.graphics.Color
import java.net.URLEncoder

/** Ramal SIP do morador, entregue pelo servidor de aprovisionamento. */
data class SipConfig(
    val displayName: String = "",
    val user: String = "",
    val password: String = "",
    val domain: String = "",
    val port: Int = 5060,
    val transport: String = "UDP"
) {
    val isComplete: Boolean
        get() = user.isNotBlank() && password.isNotBlank() && domain.isNotBlank()
}

/** Câmera liberada para o morador (RTSP / HLS / HTTP). */
data class Camera(
    val id: String,
    val name: String,
    val url: String,
    val user: String = "",
    val password: String = ""
) {
    val isRtsp: Boolean get() = url.startsWith("rtsp", ignoreCase = true)

    /** URL RTSP com usuário/senha embutidos (codificados). Para HTTP/HLS usa-se cabeçalho Basic. */
    fun streamUrl(): String {
        if (!isRtsp || user.isBlank() || !url.contains("://")) return url
        val (scheme, rest) = url.split("://", limit = 2)
        if (rest.substringBefore('/').contains("@")) return url
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        return "$scheme://${enc(user)}:${enc(password)}@$rest"
    }
}

/** Ramal que o morador pode chamar. */
data class Extension(
    val id: Long,
    val number: String,
    val label: String,
    val block: String,
    val kind: String
) {
    val title: String get() = label.ifBlank { number }
}

data class Notice(
    val id: Long,
    val kind: String,
    val title: String,
    val body: String,
    val createdAt: Long,
    val seenAt: Long = 0          // 0 = ainda não marcado como visto
) {
    val seen: Boolean get() = seenAt > 0
}

data class ChatMessage(
    val id: Long,
    val sender: String,          // "resident" | "operator"
    val operatorName: String,
    val body: String,
    val createdAt: Long,
    val kind: String = "text"     // "text" | "image" | "audio"
) {
    val fromOperator: Boolean get() = sender == "operator"
    val preview: String
        get() = when (kind) { "image" -> "📷 Foto"; "audio" -> "🎤 Áudio"; else -> body }
}

data class BrandColors(
    val primary: Color = Color(0xFFFF9800),
    val onPrimary: Color = Color.Black,
    val background: Color = Color(0xFF121212),
    val surface: Color = Color(0xFF1E1E1E),
    val surfaceAlt: Color = Color(0xFF2A2A2A),
    val text: Color = Color.White
)

/** Tudo que o servidor entrega ao app: identidade do condomínio, ramal, câmeras e ramais. */
data class Provisioned(
    val version: String,
    val condoName: String,
    val condoInfo: String,
    val condoPhone: String,
    val logoUrl: String?,
    val colors: BrandColors,
    val residentName: String,
    val residentBlock: String,
    val residentUnit: String,
    val sip: SipConfig?,
    val cameras: List<Camera>,
    val extensions: List<Extension>
)

data class PollResult(
    val version: String,
    val notices: List<Notice>,
    val messages: List<ChatMessage>
)
