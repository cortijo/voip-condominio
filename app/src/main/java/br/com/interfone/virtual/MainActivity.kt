package br.com.interfone.virtual

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.core.content.ContextCompat
import br.com.interfone.virtual.SipManager.CallStatus
import br.com.interfone.virtual.ui.Accent
import br.com.interfone.virtual.ui.BlockScreen
import br.com.interfone.virtual.ui.BlocksScreen
import br.com.interfone.virtual.ui.Bg
import br.com.interfone.virtual.ui.CallScreen
import br.com.interfone.virtual.ui.CameraViewScreen
import br.com.interfone.virtual.ui.CamerasScreen
import br.com.interfone.virtual.ui.ChatScreen
import br.com.interfone.virtual.ui.HomeScreen
import br.com.interfone.virtual.ui.VisitorsScreen
import br.com.interfone.virtual.ui.LoginScreen
import br.com.interfone.virtual.ui.Muted
import br.com.interfone.virtual.ui.NoticesScreen
import br.com.interfone.virtual.ui.PortariaScreen
import br.com.interfone.virtual.ui.SettingsScreen
import br.com.interfone.virtual.ui.Surface1
import br.com.interfone.virtual.ui.TextC
import br.com.interfone.virtual.ui.brandScheme

class MainActivity : ComponentActivity() {

    private val permissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) permissions.launch(missing.toTypedArray())
    }

    private fun startSync() {
        try {
            ContextCompat.startForegroundService(this, Intent(this, SyncService::class.java))
        } catch (e: Exception) {
            // sem permissão para serviço em primeiro plano agora; o app segue funcionando com a tela aberta
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Repo.requestMic = { askPermissions() }
        val nav = Nav()

        setContent {
            MaterialTheme(colorScheme = brandScheme()) {
                Surface(Modifier.fillMaxSize(), color = Bg, contentColor = TextC) {
                    if (!Repo.loggedIn) {
                        Column(Modifier.fillMaxSize().statusBarsPadding()) { LoginScreen() }
                    } else {
                        androidx.compose.runtime.LaunchedEffect(Unit) {
                            askPermissions()
                            startSync()
                        }
                        BackHandler(enabled = nav.stack.size > 1) { nav.pop() }
                        Box(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                                Box(Modifier.weight(1f)) {
                                    when (val r = nav.route) {
                                        Route.Home -> HomeScreen(nav)
                                        Route.Blocks -> BlocksScreen(nav)
                                        is Route.Block -> BlockScreen(nav, r.name)
                                        Route.Portaria -> PortariaScreen(nav)
                                        Route.Cameras -> CamerasScreen(nav)
                                        is Route.CameraView -> CameraViewScreen(nav, r.id)
                                        Route.Notices -> NoticesScreen()
                                        Route.Chat -> ChatScreen()
                                        Route.Visitors -> VisitorsScreen(nav)
                                        Route.Settings -> SettingsScreen()
                                    }
                                }
                                NavigationBar(containerColor = Surface1) {
                                    val root = nav.stack.first()
                                    Tab("Início", Icons.Default.Home, root == Route.Home) { nav.tab(Route.Home) }
                                    Tab("Conversas", Icons.Default.Chat, root == Route.Chat, Repo.unreadChat) { nav.tab(Route.Chat) }
                                    Tab("Avisos", Icons.Default.Campaign, root == Route.Notices, Repo.unreadNotices) { nav.tab(Route.Notices) }
                                    Tab("Câmeras", Icons.Default.Videocam, root == Route.Cameras) { nav.tab(Route.Cameras) }
                                    Tab("Ajustes", Icons.Default.Settings, root == Route.Settings) { nav.tab(Route.Settings) }
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
    }

    override fun onStart() {
        super.onStart()
        Repo.appInForeground = true
        if (Repo.loggedIn) startSync()
    }

    override fun onStop() {
        Repo.appInForeground = false
        super.onStop()
    }
}

@Composable
private fun RowScope.Tab(label: String, icon: ImageVector, selected: Boolean, badge: Int = 0, onClick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = {
            BadgedBox(badge = { if (badge > 0) Badge { Text(badge.toString()) } }) { Icon(icon, label) }
        },
        label = { Text(label) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Accent,
            selectedTextColor = Accent,
            indicatorColor = Bg,
            unselectedIconColor = Muted,
            unselectedTextColor = Muted
        )
    )
}
