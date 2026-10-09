package br.com.interfone.virtual

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Armazenamento local simples (SharedPreferences + JSON). */
class Store(context: Context) {
    private val sp = context.getSharedPreferences("interfone", Context.MODE_PRIVATE)

    fun loadSip(): SipConfig = SipConfig(
        displayName = sp.getString("sip_name", "") ?: "",
        user = sp.getString("sip_user", "") ?: "",
        password = sp.getString("sip_pass", "") ?: "",
        domain = sp.getString("sip_domain", "") ?: "",
        port = sp.getInt("sip_port", 5060),
        portariaExt = sp.getString("sip_portaria", "") ?: ""
    )

    fun saveSip(c: SipConfig) {
        sp.edit()
            .putString("sip_name", c.displayName)
            .putString("sip_user", c.user)
            .putString("sip_pass", c.password)
            .putString("sip_domain", c.domain)
            .putInt("sip_port", c.port)
            .putString("sip_portaria", c.portariaExt)
            .apply()
    }

    fun loadCameras(): List<Camera> = readArray("cameras") {
        Camera(
            id = it.getString("id"),
            name = it.getString("name"),
            url = it.getString("url"),
            user = it.optString("user"),
            password = it.optString("password")
        )
    }

    fun saveCameras(list: List<Camera>) = writeArray("cameras", list) {
        JSONObject()
            .put("id", it.id).put("name", it.name).put("url", it.url)
            .put("user", it.user).put("password", it.password)
    }

    fun loadResidents(): List<Resident> = readArray("residents") {
        Resident(
            id = it.getString("id"),
            block = it.getString("block"),
            name = it.getString("name"),
            ext = it.getString("ext")
        )
    }

    fun saveResidents(list: List<Resident>) = writeArray("residents", list) {
        JSONObject().put("id", it.id).put("block", it.block).put("name", it.name).put("ext", it.ext)
    }

    private fun <T> readArray(key: String, parse: (JSONObject) -> T): List<T> {
        val raw = sp.getString(key, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { parse(arr.getJSONObject(it)) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun <T> writeArray(key: String, list: List<T>, toJson: (T) -> JSONObject) {
        val arr = JSONArray()
        list.forEach { arr.put(toJson(it)) }
        sp.edit().putString(key, arr.toString()).apply()
    }
}
