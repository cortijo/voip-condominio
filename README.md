# Interfone Virtual (voip-condominio)

App Android (Kotlin + Jetpack Compose) de interfone virtual para condomínio. Conecta ao **Issabel/Asterisk** via SIP (Linphone SDK) e exibe as câmeras do condomínio.

## Versão 0.1 — o que já faz
- **Ajustes → Ramal VoIP**: servidor (IP do Issabel), porta, ramal, senha e ramal da portaria. Registra via SIP/UDP.
- **Falar com a portaria**: liga para o ramal da portaria.
- **Falar com morador**: Blocos A–F e Quadra → moradores (nome + ramal, cadastrados no app) ou discagem direta por ramal.
- **Tela de chamada**: viva-voz, silenciar, desligar; atender/recusar chamadas recebidas (com o app aberto).
- **Câmeras**: cadastro (nome, URL, usuário/senha) e visualização de **RTSP** (via TCP), HLS e HTTP.

## Compilar o APK (GitHub Actions)
1. Envie o projeto para o repositório (branch `main`).
2. Aba **Actions → Build APK** (roda a cada push, ou clique em *Run workflow*).
3. Ao terminar, baixe o APK em **Artifacts → interfone-virtual-debug**.
4. Para publicar em *Releases*: `git tag v0.1.0 && git push --tags`.

## Configuração no Issabel
- Crie um ramal SIP para cada morador/portaria (PBX → Extensions), com `secret` próprio.
- O app usa **UDP na porta 5060** (chan_pjsip ou chan_sip). Mantenha codecs `ulaw`/`alaw` habilitados.
- Para uso fora da rede local, é preciso liberar/encaminhar SIP + RTP (10000–20000) ou usar VPN.

## Câmeras — exemplos de URL
- `rtsp://192.168.1.50:554/stream1` (Intelbras/Hikvision costumam usar `/cam/realmonitor?channel=1&subtype=1` ou `/Streaming/Channels/102`)
- `http://servidor/camera/live.m3u8`

## Limitações da v0.1 (próximos passos)
- Chamadas recebidas só tocam com o app aberto → próximo passo: serviço em primeiro plano / push (FCM) para tocar em segundo plano.
- Moradores, câmeras e senha ficam em armazenamento local sem criptografia → migrar para EncryptedSharedPreferences e/ou provisionamento centralizado.
- Vídeo na chamada (câmera da portaria dentro da ligação) e abertura de portão via DTMF.
- APK é *debug*; para loja, configurar assinatura de release.
