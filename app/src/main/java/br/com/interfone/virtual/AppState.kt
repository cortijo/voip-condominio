package br.com.interfone.virtual

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

sealed interface Route {
    data object Home : Route
    data object Blocks : Route
    data class Block(val name: String) : Route
    data object Cameras : Route
    data class CameraView(val id: String) : Route
    data class CameraEdit(val id: String?) : Route
    data object Settings : Route
}

/** Estado do app: configuração, listas e navegação. */
class AppState(private val store: Store) {
    var sip by mutableStateOf(store.loadSip())
        private set
    val cameras = mutableStateListOf<Camera>().apply { addAll(store.loadCameras()) }
    val residents = mutableStateListOf<Resident>().apply { addAll(store.loadResidents()) }

    var stack by mutableStateOf(listOf<Route>(Route.Home))
        private set
    val route: Route get() = stack.last()

    fun push(r: Route) { stack = stack + r }
    fun pop(): Boolean {
        if (stack.size <= 1) return false
        stack = stack.dropLast(1)
        return true
    }
    fun tab(r: Route) { stack = listOf(r) }

    fun saveSip(c: SipConfig) {
        sip = c
        store.saveSip(c)
        SipManager.register(c)
    }

    fun saveCamera(c: Camera) {
        val i = cameras.indexOfFirst { it.id == c.id }
        if (i >= 0) cameras[i] = c else cameras.add(c)
        store.saveCameras(cameras.toList())
    }

    fun deleteCamera(id: String) {
        cameras.removeAll { it.id == id }
        store.saveCameras(cameras.toList())
    }

    fun addResident(r: Resident) {
        residents.add(r)
        store.saveResidents(residents.toList())
    }

    fun deleteResident(id: String) {
        residents.removeAll { it.id == id }
        store.saveResidents(residents.toList())
    }

    /** Blocos padrão + qualquer bloco criado pelo usuário. */
    fun blocks(): List<String> = (DefaultBlocks + residents.map { it.block }).distinct()
}
