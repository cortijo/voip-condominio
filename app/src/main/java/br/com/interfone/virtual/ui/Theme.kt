package br.com.interfone.virtual.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import br.com.interfone.virtual.BrandColors

/** Perfil de cores do condomínio, vindo do servidor. Observável: a interface se atualiza sozinha. */
object Brand {
    var primary by mutableStateOf(Color(0xFFFF9800))
    var onPrimary by mutableStateOf(Color.Black)
    var background by mutableStateOf(Color(0xFF121212))
    var surface by mutableStateOf(Color(0xFF1E1E1E))
    var surfaceAlt by mutableStateOf(Color(0xFF2A2A2A))
    var text by mutableStateOf(Color.White)

    fun apply(c: BrandColors) {
        primary = c.primary
        onPrimary = c.onPrimary
        background = c.background
        surface = c.surface
        surfaceAlt = c.surfaceAlt
        text = c.text
    }
}

val Accent: Color get() = Brand.primary
val OnAccent: Color get() = Brand.onPrimary
val Bg: Color get() = Brand.background
val Surface1: Color get() = Brand.surface
val Surface2: Color get() = Brand.surfaceAlt
val TextC: Color get() = Brand.text
val Muted: Color get() = Brand.text.copy(alpha = 0.6f)
val Green = Color(0xFF2E7D32)
val Red = Color(0xFFE53935)

fun brandScheme(): ColorScheme =
    if (Brand.background.luminance() < 0.5f) {
        darkColorScheme(
            primary = Brand.primary, onPrimary = Brand.onPrimary,
            background = Brand.background, onBackground = Brand.text,
            surface = Brand.surface, onSurface = Brand.text,
            surfaceVariant = Brand.surfaceAlt, onSurfaceVariant = Brand.text.copy(alpha = 0.7f)
        )
    } else {
        lightColorScheme(
            primary = Brand.primary, onPrimary = Brand.onPrimary,
            background = Brand.background, onBackground = Brand.text,
            surface = Brand.surface, onSurface = Brand.text,
            surfaceVariant = Brand.surfaceAlt, onSurfaceVariant = Brand.text.copy(alpha = 0.7f)
        )
    }
