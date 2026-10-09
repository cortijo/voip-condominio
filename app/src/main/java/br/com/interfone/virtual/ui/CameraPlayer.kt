@file:OptIn(androidx.media3.common.util.UnstableApi::class)

package br.com.interfone.virtual.ui

import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import androidx.media3.ui.PlayerView

/** Player de câmera: RTSP (via TCP) ou HLS/HTTP. */
@Composable
fun CameraPlayer(url: String, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var error by remember(url) { mutableStateOf<String?>(null) }
    val player = remember(url) {
        ExoPlayer.Builder(ctx).build().apply {
            addListener(object : Player.Listener {
                override fun onPlayerError(e: PlaybackException) {
                    error = "Falha ao abrir a câmera (${e.errorCodeName})"
                }
            })
            val item = MediaItem.fromUri(url)
            if (url.startsWith("rtsp", ignoreCase = true)) {
                setMediaSource(RtspMediaSource.Factory().setForceUseRtpTcp(true).createMediaSource(item))
            } else {
                setMediaItem(item)
            }
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }

    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize()
        )
        error?.let {
            Text(
                it, color = Color.White,
                modifier = Modifier.align(Alignment.Center).padding(16.dp)
            )
        }
    }
}
