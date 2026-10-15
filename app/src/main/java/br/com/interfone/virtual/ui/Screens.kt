package br.com.interfone.virtual.ui

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.interfone.virtual.ChatMessage
import br.com.interfone.virtual.DEFAULT_SERVER
import br.com.interfone.virtual.Extension
import br.com.interfone.virtual.Nav
import br.com.interfone.virtual.Repo
import br.com.interfone.virtual.Route
import br.com.interfone.virtual.SipManager
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

// ---------------------------------------------------------------- componentes comuns

@Composable
fun Header(title: String, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Voltar", tint = TextC) }
        } else Spacer(Modifier.size(12.dp))
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.Medium, color = TextC, modifier = Modifier.weight(1f))
        actions()
    }
}

@Composable
fun MenuCard(icon: ImageVector, text: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp)).background(Surface1)
            .clickable(onClick = onClick).padding(20.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = TextC)
        Spacer(Modifier.size(24.dp))
        Text(text, fontWeight = FontWeight.Bold, color = TextC, modifier = Modifier.weight(1f))
        Icon(Icons.Default.ChevronRight, null, tint = Muted)
    }
}

@Composable
fun ListRow(icon: ImageVector, text: String, sub: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = Accent, modifier = Modifier.size(32.dp))
        Spacer(Modifier.size(16.dp))
        Column(Modifier.weight(1f)) {
            Text(text, fontWeight = FontWeight.Medium, color = TextC)
            if (sub != null) Text(sub, fontSize = 12.sp, color = Muted)
        }
        Icon(Icons.Default.ChevronRight, null, tint = Muted)
    }
    HorizontalDivider(color = Surface2)
}

@Composable
fun Empty(text: String) {
    Text(text, color = Muted, modifier = Modifier.padding(24.dp))
}

@Composable
fun Avatar(size: Int = 96) {
    val cfg = Repo.config
    Box(Modifier.size(size.dp).clip(CircleShape).background(Surface2), contentAlignment = Alignment.Center) {
        val logo = Repo.logo
        if (logo != null) {
            Image(logo, null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(6.dp))
        } else {
            Text(
                (cfg?.condoName ?: "?").take(1).uppercase(),
                fontSize = (size / 2.4).sp, fontWeight = FontWeight.Bold, color = Accent
            )
        }
    }
}

private fun callExt(ctx: android.content.Context, number: String, label: String) {
    when {
        !SipManager.registered ->
            Toast.makeText(ctx, "Ramal não conectado: ${SipManager.registration}", Toast.LENGTH_LONG).show()
        else -> {
            Repo.requestMic?.invoke()
            if (!SipManager.call(number, label)) Toast.makeText(ctx, "Não foi possível ligar", Toast.LENGTH_SHORT).show()
        }
    }
}

private fun fmtTime(sec: Long): String =
    SimpleDateFormat("dd/MM HH:mm", Locale("pt", "BR")).format(Date(sec * 1000))

// ---------------------------------------------------------------- login / aprovisionamento

@Composable
fun LoginScreen() {
    var server by remember { mutableStateOf(Repo.savedServer.ifBlank { DEFAULT_SERVER }) }
    var code by remember { mutableStateOf(Repo.savedCode) }
    var user by remember { mutableStateOf(Repo.savedUsername) }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(48.dp))
        Box(Modifier.size(84.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Call, null, tint = OnAccent, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Interfone Virtual", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = TextC)
        Text("Entre com os dados fornecidos pelo condomínio", color = Muted, fontSize = 13.sp)
        Spacer(Modifier.height(28.dp))

        OutlinedTextField(
            server, { server = it }, label = { Text("Servidor") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            code, { code = it }, label = { Text("Código do condomínio") }, singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            user, { user = it }, label = { Text("Usuário") }, singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            pass, { pass = it }, label = { Text("Senha") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth()
        )
        error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = Red, fontSize = 13.sp)
        }
        Spacer(Modifier.height(20.dp))
        Button(
            enabled = !busy && server.isNotBlank() && code.isNotBlank() && user.isNotBlank() && pass.isNotEmpty(),
            onClick = {
                busy = true; error = null
                scope.launch {
                    try {
                        Repo.login(server, code, user, pass)
                    } catch (e: Exception) {
                        error = e.message ?: "Falha ao entrar"
                    }
                    busy = false
                }
            },
            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent),
            modifier = Modifier.fillMaxWidth().height(50.dp)
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = OnAccent, strokeWidth = 2.dp)
            else Text("ENTRAR", fontWeight = FontWeight.Bold)
        }
    }
}

// ---------------------------------------------------------------- início

@Composable
fun HomeScreen(nav: Nav) {
    val cfg = Repo.config ?: return
    val ctx = LocalContext.current
    val where = listOf(cfg.residentBlock, cfg.residentUnit).filter { it.isNotBlank() }.joinToString(" · ")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Interfone Virtual")
        Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar()
            Spacer(Modifier.height(10.dp))
            Text(cfg.condoName, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextC)
            Text(
                listOf(cfg.residentName, where).filter { it.isNotBlank() }.joinToString(" — "),
                fontSize = 13.sp, color = Muted
            )
            Spacer(Modifier.height(4.dp))
            Text(
                if (cfg.sip == null) "Sem ramal configurado" else SipManager.registration,
                fontSize = 12.sp, color = if (SipManager.registered) Color(0xFF66BB6A) else Color(0xFFEF9A9A)
            )
        }
        MenuCard(Icons.Default.Call, "FALAR COM MORADOR") { nav.push(Route.Blocks) }
        MenuCard(Icons.Default.SupportAgent, "FALAR COM A PORTARIA") {
            val list = cfg.extensions.filter { it.kind == "portaria" }
            when {
                cfg.sip == null -> Toast.makeText(ctx, "Seu usuário não tem ramal configurado.", Toast.LENGTH_LONG).show()
                list.isEmpty() -> Toast.makeText(ctx, "Nenhum ramal de portaria liberado para você.", Toast.LENGTH_LONG).show()
                list.size == 1 -> callExt(ctx, list[0].number, list[0].title)
                else -> nav.push(Route.Portaria)
            }
        }
        MenuCard(Icons.Default.Videocam, "VER CÂMERAS") { nav.tab(Route.Cameras) }
    }
}

// ---------------------------------------------------------------- ramais (moradores / portaria)

@Composable
fun BlocksScreen(nav: Nav) {
    val cfg = Repo.config ?: return
    val blocks = cfg.extensions.filter { it.kind != "portaria" }
        .groupBy { it.block.ifBlank { "OUTROS" } }.toSortedMap()
    Column(Modifier.fillMaxSize()) {
        Header("Falar com morador", onBack = { nav.pop() })
        if (blocks.isEmpty()) Empty("Nenhum ramal liberado para o seu grupo.")
        LazyColumn {
            items(blocks.keys.toList()) { b ->
                ListRow(Icons.Default.Apartment, b, "${blocks[b]!!.size} ramais") { nav.push(Route.Block(b)) }
            }
        }
    }
}

@Composable
fun ExtensionList(title: String, list: List<Extension>, onBack: () -> Unit) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        Header(title, onBack = onBack)
        if (list.isEmpty()) Empty("Nenhum ramal disponível.")
        LazyColumn {
            items(list, key = { it.id }) { e ->
                ListRow(Icons.Default.Person, e.title, "Ramal ${e.number}") { callExt(ctx, e.number, e.title) }
            }
        }
    }
}

@Composable
fun BlockScreen(nav: Nav, block: String) {
    val cfg = Repo.config ?: return
    val list = cfg.extensions.filter { it.kind != "portaria" && it.block.ifBlank { "OUTROS" } == block }
    ExtensionList(block, list) { nav.pop() }
}

@Composable
fun PortariaScreen(nav: Nav) {
    val cfg = Repo.config ?: return
    ExtensionList("Portaria", cfg.extensions.filter { it.kind == "portaria" }) { nav.pop() }
}

// ---------------------------------------------------------------- câmeras

@Composable
fun CamerasScreen(nav: Nav) {
    val cfg = Repo.config ?: return
    Column(Modifier.fillMaxSize()) {
        Header("Câmeras")
        if (cfg.cameras.isEmpty()) Empty("Nenhuma câmera liberada para o seu grupo.")
        LazyColumn {
            items(cfg.cameras, key = { it.id }) { c ->
                ListRow(Icons.Default.Videocam, c.name) { nav.push(Route.CameraView(c.id)) }
            }
        }
    }
}

@Composable
fun CameraViewScreen(nav: Nav, id: String) {
    val cam = Repo.config?.cameras?.firstOrNull { it.id == id }
    Column(Modifier.fillMaxSize()) {
        Header(cam?.name ?: "Câmera", onBack = { nav.pop() })
        if (cam != null) CameraPlayer(cam, Modifier.fillMaxWidth().aspectRatio(16f / 9f))
        else Empty("Câmera indisponível.")
    }
}

// ---------------------------------------------------------------- mural de avisos

private fun kindLabel(kind: String) = when (kind) {
    "encomenda" -> "ENCOMENDA"
    "urgente" -> "URGENTE"
    "comunicado" -> "COMUNICADO"
    else -> "AVISO"
}

@Composable
fun NoticesScreen() {
    LaunchedEffect(Repo.notices.size) { Repo.markNoticesSeen() }
    Column(Modifier.fillMaxSize()) {
        Header("Mural de avisos")
        if (Repo.notices.isEmpty()) Empty("Nenhum aviso por enquanto.")
        LazyColumn {
            items(Repo.notices, key = { it.id }) { n ->
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)
                        .clip(RoundedCornerShape(12.dp)).background(Surface1).padding(16.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            kindLabel(n.kind), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            color = if (n.kind == "urgente") Red else Accent, modifier = Modifier.weight(1f)
                        )
                        Text(fmtTime(n.createdAt), fontSize = 11.sp, color = Muted)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(n.title, fontWeight = FontWeight.Bold, color = TextC)
                    if (n.body.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(n.body, color = TextC)
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- conversas (chat com a portaria)

@Composable
private fun Bubble(m: ChatMessage) {
    val mine = !m.fromOperator
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier.widthIn(max = 280.dp).clip(RoundedCornerShape(14.dp))
                .background(if (mine) Accent else Surface1).padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            if (!mine) Text(m.operatorName.ifBlank { "Portaria" }, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Accent)
            Text(m.body, color = if (mine) OnAccent else TextC)
            Text(fmtTime(m.createdAt), fontSize = 10.sp, color = if (mine) OnAccent.copy(alpha = 0.7f) else Muted)
        }
    }
}

@Composable
fun ChatScreen() {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val ctx = LocalContext.current

    LaunchedEffect(Repo.chat.size) {
        Repo.markChatSeen()
        if (Repo.chat.isNotEmpty()) listState.scrollToItem(max(0, Repo.chat.size - 1))
    }

    Column(Modifier.fillMaxSize()) {
        Header("Conversas")
        Text("Fale com a portaria / administração", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp))
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (Repo.chat.isEmpty()) Empty("Nenhuma mensagem ainda. Escreva abaixo para começar.")
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                items(Repo.chat, key = { it.id }) { Bubble(it) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                text, { text = it }, placeholder = { Text("Mensagem") }, modifier = Modifier.weight(1f), maxLines = 4
            )
            IconButton(
                enabled = text.isNotBlank() && !sending,
                onClick = {
                    val body = text.trim()
                    sending = true
                    scope.launch {
                        try {
                            Repo.sendChat(body)
                            text = ""
                        } catch (e: Exception) {
                            Toast.makeText(ctx, e.message ?: "Falha ao enviar", Toast.LENGTH_SHORT).show()
                        }
                        sending = false
                    }
                }
            ) { Icon(Icons.Default.Send, "Enviar", tint = if (text.isNotBlank()) Accent else Muted) }
        }
    }
}

// ---------------------------------------------------------------- ajustes

@Composable
fun SettingsScreen() {
    val cfg = Repo.config ?: return
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var syncing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Ajustes")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(cfg.condoName, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextC)
            if (cfg.condoInfo.isNotBlank()) Text(cfg.condoInfo, color = Muted)
            if (cfg.condoPhone.isNotBlank()) Text("Telefone: ${cfg.condoPhone}", color = Muted)
            Spacer(Modifier.height(10.dp))
            Text("Seu acesso", fontWeight = FontWeight.Bold, color = Accent)
            Text(cfg.residentName, color = TextC)
            Text(
                cfg.sip?.let { "Ramal ${it.user} — ${SipManager.registration}" } ?: "Sem ramal configurado",
                color = if (SipManager.registered) Color(0xFF66BB6A) else Muted
            )
            Text("Servidor: ${Repo.savedServer}", color = Muted, fontSize = 12.sp)
            if (Repo.syncStatus.isNotBlank()) Text(Repo.syncStatus, color = Red, fontSize = 12.sp)
            Spacer(Modifier.height(16.dp))
            Button(
                enabled = !syncing,
                onClick = {
                    syncing = true
                    scope.launch {
                        val ok = Repo.refreshAll()
                        Toast.makeText(ctx, if (ok) "Sincronizado" else "Falha ao sincronizar", Toast.LENGTH_SHORT).show()
                        syncing = false
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = OnAccent),
                modifier = Modifier.fillMaxWidth()
            ) { Text("SINCRONIZAR AGORA") }
            OutlinedButton(onClick = { Repo.logout() }, modifier = Modifier.fillMaxWidth()) {
                Text("SAIR DESTA CONTA", color = Red)
            }
        }
    }
}
