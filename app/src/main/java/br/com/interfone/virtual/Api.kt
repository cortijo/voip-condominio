package br.com.interfone.virtual

import androidx.compose.ui.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(message: String, val code: Int) : Exception(message)

/** Cliente HTTP do servidor de aprovisionamento. Funções bloqueantes: chamar fora da thread principal. */
object Api {
    /** Preenchidos pelo Repo: o painel do operador mostra versão, aparelho e estado do ramal. */
    @Volatile var appVersion: String = ""
    @Volatile var sipState: () -> String = { "none" }

    private fun ascii(s: String) = s.filter { it.code in 32..126 }.take(60)

    fun normalizeServer(input: String): String {
        var s = input.trim().trimEnd('/')
        if (!s.startsWith("http://", true) && !s.startsWith("https://", true)) s = "http://$s"
        return s
    }

    private fun request(server: String, method: String, path: String, token: String?, body: JSONObject?, timeout: Int = 12000): String {
        val conn = try {
            URL(server + path).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw ApiException("Endereço do servidor inválido", 0)
        }
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = timeout
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) {
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("X-App-Version", ascii(appVersion))
                conn.setRequestProperty("X-Device", ascii("${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"))
                conn.setRequestProperty("X-Sip", ascii(try { sipState() } catch (e: Exception) { "none" }))
            }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = try { JSONObject(text).optString("error", "") } catch (e: Exception) { "" }
                throw ApiException(msg.ifBlank { "Erro $code do servidor" }, code)
            }
            return text
        } catch (e: IOException) {
            throw ApiException("Sem conexão com o servidor (${e.message ?: "erro de rede"})", 0)
        } finally {
            conn.disconnect()
        }
    }

    /** Retorna (token, JSON da configuração). */
    fun login(server: String, code: String, user: String, pass: String): Pair<String, String> {
        val body = JSONObject().put("code", code).put("username", user).put("password", pass)
        val res = JSONObject(request(server, "POST", "/api/app/login", null, body))
        return res.getString("token") to res.getJSONObject("config").toString()
    }

    fun configJson(server: String, token: String): String = request(server, "GET", "/api/app/config", token, null)

    fun notices(server: String, token: String): List<Notice> =
        parseNotices(JSONArray(request(server, "GET", "/api/app/notices", token, null)))

    fun chat(server: String, token: String): List<ChatMessage> =
        parseMessages(JSONArray(request(server, "GET", "/api/app/chat", token, null)))

    fun sendChat(server: String, token: String, text: String) {
        request(server, "POST", "/api/app/chat", token, JSONObject().put("body", text))
    }

    /** Marca o aviso como visto; devolve o instante (segundos) registrado pelo servidor. */
    fun markSeen(server: String, token: String, id: Long): Long {
        val o = JSONObject(request(server, "POST", "/api/app/notices/$id/seen", token, JSONObject()))
        return o.optLong("seen_at", System.currentTimeMillis() / 1000)
    }

    /** Envia foto (JPEG) ou áudio (m4a) para o chat. */
    fun sendMedia(server: String, token: String, kind: String, bytes: ByteArray) {
        val data = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        request(server, "POST", "/api/app/chat/media", token, JSONObject().put("kind", kind).put("data", data), 60000)
    }

    /** Baixa um anexo do chat (rota autenticada). */
    fun fetchAuth(server: String, token: String, path: String): ByteArray? = try {
        val c = URL(server + path).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 30000
        c.setRequestProperty("Authorization", "Bearer $token")
        try { if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null } finally { c.disconnect() }
    } catch (e: Exception) { null }

    fun poll(server: String, token: String, n: Long, m: Long): PollResult {
        val o = JSONObject(request(server, "GET", "/api/app/poll?n=$n&m=$m", token, null))
        return PollResult(o.getString("version"), parseNotices(o.getJSONArray("notices")), parseMessages(o.getJSONArray("messages")))
    }

    fun logout(server: String, token: String) {
        try { request(server, "POST", "/api/app/logout", token, JSONObject()) } catch (e: ApiException) { /* ignora */ }
    }

    fun fetchBytes(url: String): ByteArray? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 12000
        try { if (c.responseCode == 200) c.inputStream.use { it.readBytes() } else null } finally { c.disconnect() }
    } catch (e: Exception) { null }

    // ------------------------------------------------------------------ parsing

    private fun hex(o: JSONObject, key: String, def: Color): Color = try {
        Color(android.graphics.Color.parseColor(o.optString(key, "")))
    } catch (e: Exception) { def }

    fun parseConfig(json: String): Provisioned {
        val o = JSONObject(json)
        val condo = o.getJSONObject("condo")
        val res = o.getJSONObject("resident")
        val d = BrandColors()
        val c = condo.getJSONObject("colors")
        val colors = BrandColors(
            primary = hex(c, "primary", d.primary),
            onPrimary = hex(c, "onPrimary", d.onPrimary),
            background = hex(c, "background", d.background),
            surface = hex(c, "surface", d.surface),
            surfaceAlt = hex(c, "surfaceAlt", d.surfaceAlt),
            text = hex(c, "text", d.text)
        )
        val sip = if (o.isNull("sip")) null else o.getJSONObject("sip").let {
            SipConfig(
                displayName = it.optString("displayName", ""),
                user = it.getString("user"),
                password = it.optString("password", ""),
                domain = it.getString("host"),
                port = it.optInt("port", 5060),
                transport = it.optString("transport", "UDP")
            )
        }
        val cams = o.getJSONArray("cameras")
        val exts = o.getJSONArray("extensions")
        return Provisioned(
            version = o.optString("version", ""),
            condoName = condo.optString("name", ""),
            condoInfo = condo.optString("info", ""),
            condoPhone = condo.optString("phone", ""),
            logoUrl = if (condo.isNull("logoUrl")) null else condo.getString("logoUrl"),
            colors = colors,
            residentName = res.optString("name", ""),
            residentBlock = res.optString("block", ""),
            residentUnit = res.optString("unit", ""),
            sip = sip,
            cameras = (0 until cams.length()).map {
                val x = cams.getJSONObject(it)
                Camera(x.get("id").toString(), x.optString("name", ""), x.optString("url", ""), x.optString("user", ""), x.optString("password", ""))
            },
            extensions = (0 until exts.length()).map {
                val x = exts.getJSONObject(it)
                Extension(x.getLong("id"), x.optString("number", ""), x.optString("label", ""), x.optString("block", ""), x.optString("kind", "morador"))
            }
        )
    }

    private fun parseNotices(a: JSONArray) = (0 until a.length()).map {
        val x = a.getJSONObject(it)
        Notice(x.getLong("id"), x.optString("kind", "aviso"), x.optString("title", ""), x.optString("body", ""), x.optLong("created_at", 0), x.optLong("seen_at", 0))
    }

    private fun parseMessages(a: JSONArray) = (0 until a.length()).map {
        val x = a.getJSONObject(it)
        ChatMessage(x.getLong("id"), x.optString("sender", ""), x.optString("operator_name", ""), x.optString("body", ""), x.optLong("created_at", 0), x.optString("kind", "text").ifBlank { "text" })
    }
}
