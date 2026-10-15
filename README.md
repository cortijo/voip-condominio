# Interfone Virtual (voip-condominio)

Sistema de interfone virtual para condomínios, integrado ao **Issabel/Asterisk** via SIP.

- **`app/`** — aplicativo Android (Kotlin + Jetpack Compose + Linphone SDK)
- **`server/`** — servidor de sincronismo e aprovisionamento (Node.js + SQLite, Docker, porta **9670**) com os painéis web

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
| **Operador** | Painel com **avisos/push** (ex.: encomenda chegou), **chat** com moradores e consulta de moradores. |

**Grupo de acesso:** define quais câmeras o morador pode ver e para quais ramais pode ligar. O morador sem grupo não vê câmeras nem liga para ninguém.

## Instalar o servidor (Docker)

```bash
git clone https://github.com/cortijo/voip-condominio.git
cd voip-condominio
cp .env.example .env        # defina ADMIN_USER e ADMIN_PASSWORD (mín. 8 caracteres)
docker compose up -d --build
docker logs interfone-server   # confirma "ouvindo na porta 9670"
```

- Abra `http://45.224.165.42:9670` e entre com o administrador primário. Libere a **porta TCP 9670** no firewall do servidor.
- Se `ADMIN_PASSWORD` ficar vazio, uma senha aleatória é gerada e mostrada **uma vez** em `docker logs`.
- Os dados ficam no volume Docker `interfone-data` (banco SQLite + logotipos). **Faça backup desse volume.**
- Esqueceu a senha do primário: `docker exec -it interfone-server node src/reset-admin.js "NovaSenhaForte123"`
- Atualizar: `git pull && docker compose up -d --build` (os dados são preservados).

## Primeiro uso (passo a passo)

1. **Painel → Condomínios → Novo condomínio** (nome + *código*, ex.: `jardim`). O código é o que o morador digita no app.
2. **Design e informações:** logotipo, cores, endereço/telefone. **Servidor VoIP:** IP/porta/transporte do Issabel.
3. **Equipe do painel:** crie o administrador do condomínio (e depois ele cria os operadores).
4. Como administrador do condomínio: **Ramais VoIP** (número + *secret* iguais aos do Issabel; tipo *Portaria* para a portaria), **Câmeras**, **Grupos de acesso**, **Moradores** (usuário/senha do app, grupo e ramal).
5. No app: servidor `http://45.224.165.42:9670`, código do condomínio, usuário e senha do morador. O app recebe sozinho ramal, câmeras, ramais, nome e cores — e se atualiza quando o painel muda.

## App Android

Compilado pelo GitHub Actions: **Actions → Build APK → Artifacts → `interfone-virtual-debug`**.
Para publicar em *Releases*: `git tag v0.2.0 && git push --tags`.

O app consulta o servidor a cada ~10 s (serviço em primeiro plano, com notificação fixa "Interfone conectado"): traz avisos, mensagens do chat e mudanças de configuração, e mantém o ramal registrado para receber chamadas.

## Testes

```bash
cd server && npm ci && npm test   # 27 verificações de ponta a ponta (API, permissões, isolamento, app, chat)
```
O CI também constrói a imagem Docker e sobe o container na porta 9670.

## Limitações conhecidas / próximos passos

- **Tráfego em HTTP puro.** Login, senhas de ramal e URLs de câmeras trafegam sem criptografia. Para uso pela internet, coloque um proxy com HTTPS (ex.: Caddy + domínio) na frente e use `https://…` no app (`TRUST_PROXY=1`).
- **Push sem Firebase.** As notificações vêm por consulta periódica (~10 s) enquanto o serviço está ativo; fabricantes com economia de bateria agressiva podem pausá-lo. Push real (FCM) exige um projeto Firebase — é o próximo passo recomendado.
- **Chamada recebida em segundo plano:** toca via notificação; atender com a tela bloqueada e áudio em segundo plano ainda precisa de testes em aparelhos reais.
- Senhas de ramal ficam em texto no banco do servidor (o app precisa delas para registrar). Proteja o volume `/data`.
- APK de teste (*debug*), sem assinatura de release.
