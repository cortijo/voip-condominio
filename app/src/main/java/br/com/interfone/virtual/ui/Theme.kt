package br.com.interfone.virtual.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.material3.darkColorScheme

val Orange = Color(0xFFFF9800)
val Bg = Color(0xFF121212)
val Surface1 = Color(0xFF1E1E1E)
val Surface2 = Color(0xFF2A2A2A)
val Green = Color(0xFF2E7D32)
val Red = Color(0xFFE53935)

val InterfoneColors = darkColorScheme(
    primary = Orange,
    onPrimary = Color.Black,
    background = Bg,
    onBackground = Color.White,
    surface = Surface1,
    onSurface = Color.White,
    surfaceVariant = Surface2,
    onSurfaceVariant = Color(0xFFBDBDBD)
)
