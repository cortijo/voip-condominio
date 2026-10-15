# Interfone Virtual (voip-condominio)

Sistema de interfone virtual para condomínios, integrado ao **Issabel/Asterisk** via SIP.

- **`app/`** — aplicativo Android (Kotlin + Jetpack Compose + Linphone SDK)
- **`server/`** — servidor de sincronismo e aprovisionamento (Node.js + SQLite, Docker, portas **9670** HTTP e **9671** HTTPS) com os painéis web

```
 Painel web ──┐                      ┌── App do morador (ramal, câmeras, ramais, avisos, chat)
 (primário,   ├──►  Servidor :9670 ◄─┤
  condomínio, │      (aprovisiona)   └── Issabel/Asterisk (SIP) ◄── App (liga/recebe chamadas)
  operador) ──┘
```

## Perfis do painel (`http://SERVIDOR:9670`)

| Perfil | O que faz |
|---|---|
| **Administrador primário** | Cria/administra condomínios; define **logotipo, cores e informações** que aparecem no app; configura o **servidor VoIP** (Issabel) de cada condomínio; cria os administradores dos condomínios. |
| **Administrador do condomínio** | Cadastra **operadores**, **ramais VoIP**, **câmeras**, **grupos de acesso** e **moradores**. |
| **Operador** | **Avisos/push** (com controle de *visto* por morador), **chat** com texto, foto e áudio, lista de **aplicativos conectados** (com envio de notificação) e **telefone VoIP no navegador**. |

**Grupo de acesso:** define quais câmeras o morador pode ver e para quais ramais pode ligar. O morador sem grupo não vê câmeras nem liga para ninguém.

## Instalar o servidor (Docker)

```bash
git clone https://github.com/cortijo/voip-condominio.git
cd voip-condominio
cp .env.example .env        # defina ADMIN_USER e ADMIN_PASSWORD (mín. 8 caracteres)
docker compose up -d --build
docker logs interfone-server   # confirma "ouvindo na porta 9670"
```

- Abra `http://45.224.165.42:9670` e entre com o administrador primário. Libere as portas **TCP 9670** (app) e **9671** (painel HTTPS) no firewall.
- Defina `PUBLIC_HOST` no `.env` (ex.: `45.224.165.42`) — vai no certificado HTTPS autoassinado da porta 9671. Para certificado real use `TLS_CERT`/`TLS_KEY` (caminhos montados no container).
- Se `ADMIN_PASSWORD` ficar vazio, uma senha aleatória é gerada e mostrada **uma vez** em `docker logs`.
- Os dados ficam no volume Docker `interfone-data` (banco SQLite + logotipos). **Faça backup desse volume.**
- Esqueceu a senha do primário: `docker exec -it interfone-server node src/reset-admin.js "NovaSenhaForte123"`
- Atualizar: `git pull && docker compose up -d --build` (os dados são preservados).
- Se o build falhar por falta de internet no container, confirme que o servidor alcança `registry.npmjs.org` (porta 443): `curl -sI https://registry.npmjs.org | head -1`. O `docker-compose.yml` já usa a rede do host no build.

## Primeiro uso (passo a passo)

1. **Painel → Condomínios → Novo condomínio** (nome; o *código* do condomínio é gerado automaticamente, ou digite o seu). O código é o que o morador digita no app.
2. **Design e informações:** logotipo (PNG transparente — aparece grande, sem moldura), cores, endereço/telefone. **Servidor VoIP:** IP/porta/transporte do Issabel e, para o telefone do operador, a URL WebSocket (`wss://…`).
3. **Equipe do painel:** crie o administrador do condomínio (e depois ele cria os operadores).
4. Como administrador do condomínio: **Ramais VoIP** (número + *secret* iguais aos do Issabel), **Ramal da portaria** (cadastro dedicado; todos os moradores o recebem automaticamente), **Câmeras**, **Grupos de acesso**, **Moradores** (usuário/senha do app, grupo e ramal).
5. **Operador no navegador:** em *Equipe do painel*, vincule a cada operador um ramal (tipo Portaria/Outro, exclusivo dele). Abra o painel por **`https://SERVIDOR:9671`** (aceite o certificado autoassinado uma vez) — o microfone só funciona em HTTPS — e use o menu **Telefone**.
6. No app: servidor `http://45.224.165.42:9670`, código do condomínio, usuário e senha do morador. O app recebe sozinho ramal, câmeras, ramais, nome e cores — e se atualiza quando o painel muda.

## App Android

Compilado pelo GitHub Actions: **Actions → Build APK → Artifacts → `interfone-virtual-debug`**.
Para publicar em *Releases*: `git tag v0.3.0 && git push --tags`.

No app (v0.3): cada aviso tem o botão **Marcar como visto** (o painel mostra *Visto n/m* e quem viu); o chat aceita **foto** e **mensagem de voz**; a tela inicial exibe o logotipo grande e o nome do condomínio/morador em destaque.

O app consulta o servidor a cada ~10 s (serviço em primeiro plano, com notificação fixa "Interfone conectado"): traz avisos, mensagens do chat e mudanças de configuração, e mantém o ramal registrado para receber chamadas.

## Liberação de visitas

1. No app, **Liberar visita** → o morador gera um link (`http://SERVIDOR:9670/v/…`, válido por 7 dias ou até a data prevista + 1 dia) e envia ao visitante pelo WhatsApp/SMS.
2. O visitante abre o link no celular e informa **nome, CPF ou RG, veículo e placa (opcionais), telefone** e tira a **foto** (abre a câmera frontal). Pode enviar sem foto: a portaria confere na chegada.
3. No painel (**Visitas**) o porteiro vê os cadastros, abre os detalhes (com foto), e usa **Liberar entrada / Recusar / Registrar saída**. O morador recebe um aviso a cada etapa. O porteiro também pode cadastrar visitantes na hora ou gerar links.

Dados pessoais (LGPD): fotos e documentos só saem por rotas autenticadas; visitas são apagadas automaticamente após 90 dias (`VISIT_RETENTION_DAYS`). Se o servidor estiver atrás de um domínio/proxy, defina `PUBLIC_URL` para os links saírem com o endereço certo.

## Telefone do operador no navegador (requisitos no Issabel)

O painel usa JsSIP (SIP sobre WebSocket + WebRTC). No Issabel/Asterisk é preciso: transporte **WSS** habilitado (porta 8089, `/ws`), ramal **PJSIP** com `webrtc=yes` (Asterisk 16+, Issabel 5) e a URL `wss://IP:8089/ws` informada no condomínio. O navegador precisa aceitar o certificado do Issabel (abra `https://IP:8089/ws` uma vez). Issabel 4 (Asterisk 11) normalmente **não** suporta WebRTC.

## Testes

```bash
cd server && npm ci && npm test   # 34 verificações de ponta a ponta (API, permissões, isolamento, app, chat, aviso visto, mídia, dispositivos, HTTPS)
```
O CI também constrói a imagem Docker e sobe o container nas portas 9670 e 9671.

## Limitações conhecidas / próximos passos

- **Telefone do navegador testado só com PBX simulado** (registro, chamada recebida, atender, desligar); falta validar com o seu Issabel real. O chat de áudio gravado no navegador usa WebM/Opus (toca no app Android 5+; não testado em aparelho real).
- **Tráfego em HTTP puro (porta 9670).** Login, senhas de ramal e URLs de câmeras trafegam sem criptografia. Para uso pela internet, coloque um proxy com HTTPS (ex.: Caddy + domínio) na frente e use `https://…` no app (`TRUST_PROXY=1`).
- **Push sem Firebase.** As notificações vêm por consulta periódica (~10 s) enquanto o serviço está ativo; fabricantes com economia de bateria agressiva podem pausá-lo. Push real (FCM) exige um projeto Firebase — é o próximo passo recomendado.
- **Chamada recebida em segundo plano:** toca via notificação; atender com a tela bloqueada e áudio em segundo plano ainda precisa de testes em aparelhos reais.
- Senhas de ramal ficam em texto no banco do servidor (o app precisa delas para registrar). Proteja o volume `/data`.
- APK de teste (*debug*), sem assinatura de release.
