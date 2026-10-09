package br.com.interfone.virtual

import java.util.UUID

/** Configuração do ramal SIP (Issabel/Asterisk). */
data class SipConfig(
    val displayName: String = "",
    val user: String = "",          // número do ramal, ex: 1001
    val password: String = "",      // secret do ramal
    val domain: String = "",        // IP ou hostname do Issabel
    val port: Int = 5060,
    val portariaExt: String = "",   // ramal da portaria
    val transport: String = "UDP"   // UDP | TCP
) {
    val isComplete: Boolean
        get() = user.isNotBlank() && password.isNotBlank() && domain.isNotBlank()
}

/** Câmera do condomínio (RTSP / HLS / HTTP). */
data class Camera(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "",
    val url: String = "",
    val user: String = "",
    val password: String = ""
) {
    /** URL com usuário/senha embutidos (necessário para RTSP). */
    fun streamUrl(): String {
        if (user.isBlank() || !url.contains("://")) return url
        val (scheme, rest) = url.split("://", limit = 2)
        if (rest.contains("@")) return url
        return "$scheme://$user:$password@$rest"
    }
}

/** Morador/ramal de um bloco. */
data class Resident(
    val id: String = UUID.randomUUID().toString(),
    val block: String = "",
    val name: String = "",
    val ext: String = ""
)

val DefaultBlocks = listOf("BLOCO A", "BLOCO B", "BLOCO C", "BLOCO D", "BLOCO E", "BLOCO F", "QUADRA")
