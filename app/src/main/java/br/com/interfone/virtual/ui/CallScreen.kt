package br.com.interfone.virtual.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.interfone.virtual.SipManager
import br.com.interfone.virtual.SipManager.CallStatus

/** Tela cheia de chamada (saindo, recebendo ou em andamento). */
@Composable
fun CallScreen() {
    val status = SipManager.callStatus
    val statusText = when (status) {
        CallStatus.OUTGOING -> "Chamando…"
        CallStatus.INCOMING -> "Chamada recebida"
        CallStatus.CONNECTED -> "Em chamada"
        CallStatus.NONE -> ""
    }
    Column(
        Modifier.fillMaxSize().background(Bg).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(72.dp))
        Box(
            Modifier.size(96.dp).clip(CircleShape).background(Surface2),
            contentAlignment = Alignment.Center
        ) {
            Text(
                SipManager.peer.take(1).uppercase().ifBlank { "?" },
                fontSize = 40.sp, fontWeight = FontWeight.Bold, color = Orange
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(SipManager.peer, fontSize = 22.sp, fontWeight = FontWeight.Medium, color = Color.White)
        Spacer(Modifier.height(8.dp))
        Text(statusText, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)

        Spacer(Modifier.weight(1f))

        if (status != CallStatus.INCOMING) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                SmallAction(Icons.Default.VolumeUp, "VIVA-VOZ", SipManager.speakerOn) { SipManager.toggleSpeaker() }
                SmallAction(
                    if (SipManager.micMuted) Icons.Default.MicOff else Icons.Default.Mic,
                    "SILENCIAR", SipManager.micMuted
                ) { SipManager.toggleMute() }
            }
            Spacer(Modifier.height(40.dp))
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            RoundButton(Icons.Default.CallEnd, Red) { SipManager.hangUp() }
            if (status == CallStatus.INCOMING) {
                RoundButton(Icons.Default.Call, Green) { SipManager.answer() }
            }
        }
        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun SmallAction(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(icon, label, tint = if (active) Orange else Color.White)
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 10.sp, color = if (active) Orange else Color.White)
    }
}

@Composable
private fun RoundButton(icon: ImageVector, color: Color, onClick: () -> Unit) {
    Box(
        Modifier.size(68.dp).clip(CircleShape).background(color).clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, null, tint = Color.White, modifier = Modifier.size(30.dp))
    }
}
