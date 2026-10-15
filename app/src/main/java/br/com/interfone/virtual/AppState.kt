package br.com.interfone.virtual

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

sealed interface Route {
    data object Home : Route
    data object Blocks : Route
    data class Block(val name: String) : Route
    data object Portaria : Route
    data object Cameras : Route
    data class CameraView(val id: String) : Route
    data object Notices : Route
    data object Chat : Route
    data object Settings : Route
}

/** Pilha de navegação simples; cada aba da barra inferior reinicia a pilha. */
class Nav {
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
}
