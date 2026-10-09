package br.com.interfone.virtual

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import br.com.interfone.virtual.SipManager.CallStatus
import br.com.interfone.virtual.ui.BlockScreen
import br.com.interfone.virtual.ui.BlocksScreen
import br.com.interfone.virtual.ui.Bg
import br.com.interfone.virtual.ui.CallScreen
import br.com.interfone.virtual.ui.CameraEditScreen
import br.com.interfone.virtual.ui.CameraViewScreen
import br.com.interfone.virtual.ui.CamerasScreen
import br.com.interfone.virtual.ui.HomeScreen
import br.com.interfone.virtual.ui.InterfoneColors
import br.com.interfone.virtual.ui.Orange
import br.com.interfone.virtual.ui.SettingsScreen
import br.com.interfone.virtual.ui.Surface1

class MainActivity : ComponentActivity() {

    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        micPermission.launch(Manifest.permission.RECORD_AUDIO)
        val state = AppState(Store(this))

        setContent {
            MaterialTheme(colorScheme = InterfoneColors) {
                BackHandler(enabled = state.stack.size > 1) { state.pop() }
                Box(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().statusBarsPadding()) {
                        Box(Modifier.weight(1f)) {
                            when (val r = state.route) {
                                Route.Home -> HomeScreen(state)
                                Route.Blocks -> BlocksScreen(state)
                                is Route.Block -> BlockScreen(state, r.name)
                                Route.Cameras -> CamerasScreen(state)
                                is Route.CameraView -> CameraViewScreen(state, r.id)
                                is Route.CameraEdit -> CameraEditScreen(state, r.id)
                                Route.Settings -> SettingsScreen(state)
                            }
                        }
                        NavigationBar(containerColor = Surface1) {
                            Tab("Início", Icons.Default.Home, state.stack.first() == Route.Home) { state.tab(Route.Home) }
                            Tab("Câmeras", Icons.Default.Videocam, state.stack.first() == Route.Cameras) { state.tab(Route.Cameras) }
                            Tab("Ajustes", Icons.Default.Settings, state.stack.first() == Route.Settings) { state.tab(Route.Settings) }
                        }
                    }
                    if (SipManager.callStatus != CallStatus.NONE) {
                        Box(Modifier.fillMaxSize().statusBarsPadding()) { CallScreen() }
                    }
                }
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun androidx.compose.foundation.layout.RowScope.Tab(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    onClick: () -> Unit
) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, label) },
        label = { Text(label) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Orange,
            selectedTextColor = Orange,
            indicatorColor = Bg,
            unselectedIconColor = Color.Gray,
            unselectedTextColor = Color.Gray
        )
    )
}
