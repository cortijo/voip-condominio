package br.com.interfone.virtual.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.interfone.virtual.AppState
import br.com.interfone.virtual.Camera
import br.com.interfone.virtual.Resident
import br.com.interfone.virtual.SipConfig
import br.com.interfone.virtual.SipManager

// ---------- componentes comuns ----------

@Composable
fun Header(title: String, onBack: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Voltar", tint = Color.White) }
        } else Spacer(Modifier.width(12.dp))
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
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
        Icon(icon, null, tint = Color.White)
        Spacer(Modifier.width(24.dp))
        Text(text, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Icon(Icons.Default.ChevronRight, null, tint = Color.Gray)
    }
}

@Composable
fun ListRow(icon: ImageVector, text: String, sub: String? = null, onClick: () -> Unit, trailing: @Composable () -> Unit = {
    Icon(Icons.Default.ChevronRight, null, tint = Color.Gray)
}) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, null, tint = Orange, modifier = Modifier.size(32.dp))
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(text, fontWeight = FontWeight.Medium)
            if (sub != null) Text(sub, fontSize = 12.sp, color = Color.Gray)
        }
        trailing()
    }
    HorizontalDivider(color = Surface2)
}

fun callOrWarn(ctx: android.content.Context, state: AppState, ext: String, label: String) {
    when {
        !state.sip.isComplete -> Toast.makeText(ctx, "Configure o ramal em Ajustes", Toast.LENGTH_LONG).show()
        !SipManager.registered -> Toast.makeText(ctx, "Ramal não registrado: ${SipManager.registration}", Toast.LENGTH_LONG).show()
        ext.isBlank() -> Toast.makeText(ctx, "Ramal de destino não informado", Toast.LENGTH_LONG).show()
        else -> SipManager.call(ext, label)
    }
}

// ---------- Início ----------

@Composable
fun HomeScreen(state: AppState) {
    val ctx = LocalContext.current
    val name = state.sip.displayName.ifBlank { state.sip.user.ifBlank { "Morador" } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Interfone Virtual")
        Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(96.dp).clip(CircleShape).background(Surface2),
                contentAlignment = Alignment.Center
            ) { Text(name.take(1).uppercase(), fontSize = 40.sp, fontWeight = FontWeight.Bold, color = Orange) }
            Spacer(Modifier.height(8.dp))
            Text(name, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.height(4.dp))
            Text(
                SipManager.registration, fontSize = 12.sp,
                color = if (SipManager.registered) Color(0xFF66BB6A) else Color(0xFFEF9A9A)
            )
        }
        MenuCard(Icons.Default.Call, "FALAR COM MORADOR") { state.push(br.com.interfone.virtual.Route.Blocks) }
        MenuCard(Icons.Default.SupportAgent, "FALAR COM A PORTARIA") {
            callOrWarn(ctx, state, state.sip.portariaExt, "Portaria")
        }
        MenuCard(Icons.Default.Videocam, "VER CÂMERAS") { state.tab(br.com.interfone.virtual.Route.Cameras) }
    }
}

// ---------- Moradores ----------

@Composable
fun BlocksScreen(state: AppState) {
    val ctx = LocalContext.current
    var dialog by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Header("Falar com morador", onBack = { state.pop() }) {
            IconButton(onClick = { dialog = true }) { Icon(Icons.Default.Dialpad, "Ramal direto", tint = Color.White) }
        }
        LazyColumn {
            items(state.blocks()) { b ->
                ListRow(Icons.Default.Apartment, b, onClick = { state.push(br.com.interfone.virtual.Route.Block(b)) })
            }
        }
    }
    if (dialog) {
        var ext by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { dialog = false },
            title = { Text("Ligar para ramal") },
            text = {
                OutlinedTextField(
                    ext, { ext = it }, label = { Text("Ramal") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                )
            },
            confirmButton = {
                TextButton(onClick = { dialog = false; callOrWarn(ctx, state, ext.trim(), ext.trim()) }) { Text("Ligar") }
            },
            dismissButton = { TextButton(onClick = { dialog = false }) { Text("Cancelar") } }
        )
    }
}

@Composable
fun BlockScreen(state: AppState, block: String) {
    val ctx = LocalContext.current
    var dialog by remember { mutableStateOf(false) }
    val list = state.residents.filter { it.block == block }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Header(block, onBack = { state.pop() })
            if (list.isEmpty()) {
                Text(
                    "Nenhum morador cadastrado neste bloco.\nToque em + para adicionar nome e ramal.",
                    color = Color.Gray, modifier = Modifier.padding(24.dp)
                )
            }
            LazyColumn {
                items(list, key = { it.id }) { r ->
                    ListRow(
                        Icons.Default.Person, r.name, "Ramal ${r.ext}",
                        onClick = { callOrWarn(ctx, state, r.ext, r.name) },
                        trailing = {
                            IconButton(onClick = { state.deleteResident(r.id) }) {
                                Icon(Icons.Default.Delete, "Excluir", tint = Color.Gray)
                            }
                        }
                    )
                }
            }
        }
        FloatingActionButton(
            onClick = { dialog = true },
            modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
            containerColor = Orange
        ) { Icon(Icons.Default.Add, "Adicionar", tint = Color.Black) }
    }
    if (dialog) {
        var name by remember { mutableStateOf("") }
        var ext by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { dialog = false },
            title = { Text("Novo morador") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Nome / Apto") }, singleLine = true)
                    OutlinedTextField(
                        ext, { ext = it }, label = { Text("Ramal") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank() && ext.isNotBlank(),
                    onClick = { state.addResident(Resident(block = block, name = name.trim(), ext = ext.trim())); dialog = false }
                ) { Text("Salvar") }
            },
            dismissButton = { TextButton(onClick = { dialog = false }) { Text("Cancelar") } }
        )
    }
}

// ---------- Câmeras ----------

@Composable
fun CamerasScreen(state: AppState) {
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Header("Câmeras")
            if (state.cameras.isEmpty()) {
                Text(
                    "Nenhuma câmera cadastrada.\nToque em + para adicionar (RTSP, HLS ou HTTP).",
                    color = Color.Gray, modifier = Modifier.padding(24.dp)
                )
            }
            LazyColumn {
                items(state.cameras, key = { it.id }) { c ->
                    ListRow(
                        Icons.Default.Videocam, c.name, c.url,
                        onClick = { state.push(br.com.interfone.virtual.Route.CameraView(c.id)) },
                        trailing = {
                            IconButton(onClick = { state.push(br.com.interfone.virtual.Route.CameraEdit(c.id)) }) {
                                Icon(Icons.Default.Edit, "Editar", tint = Color.Gray)
                            }
                        }
                    )
                }
            }
        }
        FloatingActionButton(
            onClick = { state.push(br.com.interfone.virtual.Route.CameraEdit(null)) },
            modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
            containerColor = Orange
        ) { Icon(Icons.Default.Add, "Adicionar câmera", tint = Color.Black) }
    }
}

@Composable
fun CameraViewScreen(state: AppState, id: String) {
    val cam = state.cameras.firstOrNull { it.id == id }
    Column(Modifier.fillMaxSize()) {
        Header(cam?.name ?: "Câmera", onBack = { state.pop() })
        if (cam != null) {
            CameraPlayer(cam.streamUrl(), Modifier.fillMaxWidth().aspectRatio(16f / 9f))
        }
    }
}

@Composable
fun CameraEditScreen(state: AppState, id: String?) {
    val existing = state.cameras.firstOrNull { it.id == id }
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var url by remember { mutableStateOf(existing?.url ?: "") }
    var user by remember { mutableStateOf(existing?.user ?: "") }
    var pass by remember { mutableStateOf(existing?.password ?: "") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header(if (existing == null) "Nova câmera" else "Editar câmera", onBack = { state.pop() }) {
            if (existing != null) {
                IconButton(onClick = { state.deleteCamera(existing.id); state.pop() }) {
                    Icon(Icons.Default.Delete, "Excluir", tint = Color.White)
                }
            }
        }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Nome (ex: Portaria, Garagem)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                url, { url = it }, label = { Text("URL do stream") },
                supportingText = { Text("Ex: rtsp://192.168.1.50:554/stream1  ou  http://…/live.m3u8") },
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(user, { user = it }, label = { Text("Usuário (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                pass, { pass = it }, label = { Text("Senha (opcional)") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
            )
            Button(
                enabled = name.isNotBlank() && url.isNotBlank(),
                onClick = {
                    state.saveCamera(
                        Camera(id = existing?.id ?: java.util.UUID.randomUUID().toString(),
                            name = name.trim(), url = url.trim(), user = user.trim(), password = pass)
                    )
                    state.pop()
                },
                colors = ButtonDefaults.buttonColors(containerColor = Orange, contentColor = Color.Black),
                modifier = Modifier.fillMaxWidth()
            ) { Text("SALVAR") }
        }
    }
}

// ---------- Ajustes (ramal VoIP) ----------

@Composable
fun SettingsScreen(state: AppState) {
    val s = state.sip
    var displayName by remember { mutableStateOf(s.displayName) }
    var user by remember { mutableStateOf(s.user) }
    var pass by remember { mutableStateOf(s.password) }
    var domain by remember { mutableStateOf(s.domain) }
    var port by remember { mutableStateOf(s.port.toString()) }
    var portaria by remember { mutableStateOf(s.portariaExt) }
    val ctx = LocalContext.current

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Header("Ajustes")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Ramal VoIP (Issabel)", fontWeight = FontWeight.Bold, color = Orange)
            OutlinedTextField(displayName, { displayName = it }, label = { Text("Seu nome / apartamento") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(domain, { domain = it.trim() }, label = { Text("Servidor (IP ou domínio do Issabel)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    user, { user = it.trim() }, label = { Text("Ramal") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    port, { port = it.filter(Char::isDigit) }, label = { Text("Porta") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(110.dp)
                )
            }
            OutlinedTextField(
                pass, { pass = it }, label = { Text("Senha do ramal (secret)") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                portaria, { portaria = it.trim() }, label = { Text("Ramal da portaria") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    state.saveSip(
                        SipConfig(displayName.trim(), user, pass, domain, port.toIntOrNull() ?: 5060, portaria)
                    )
                    Toast.makeText(ctx, "Salvo. Registrando ramal…", Toast.LENGTH_SHORT).show()
                },
                colors = ButtonDefaults.buttonColors(containerColor = Orange, contentColor = Color.Black),
                modifier = Modifier.fillMaxWidth()
            ) { Text("SALVAR E REGISTRAR") }
            Text(
                "Status: ${SipManager.registration}",
                color = if (SipManager.registered) Color(0xFF66BB6A) else Color(0xFFEF9A9A)
            )
        }
    }
}
