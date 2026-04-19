# Spire Scryer

Slay the Spire 2 deck/relics/potions overlay for streamers. Live game state from the mod is pushed to a Cloudflare Worker, broadcast over Twitch PubSub, and rendered as a Twitch Extension Video Overlay on the streamer's channel.

Inspired by [Slay the Relics](https://github.com/Spireblight/slay-the-relics).

## Architecture

```
┌──────────────────┐    HTTPS     ┌─────────────────────┐   PubSub   ┌──────────────┐
│ Slay the Spire 2 │ ──────────▶ │ Cloudflare Worker   │ ─────────▶ │ Twitch       │
│ + SpireScryer    │              │ (EBS) + KV fallback │            │ Extension    │
│ mod              │              │                     │            │ (viewers)    │
└──────────────────┘              └─────────────────────┘            └──────────────┘
```

- **Mod** (`Code/`) — reads `RunManager` state, serializes to DTOs, pushes every 10 s to the EBS (skips pushes when state hash is unchanged, sends a keep-alive every 30 s).
- **EBS** (`ebs/`) — Cloudflare Worker + KV. Authenticates the mod via a per-channel shared secret, compresses the payload, broadcasts via Twitch PubSub, and keeps the latest payload in KV for up to 5 minutes as a fallback for late-joining viewers.
- **Twitch Extension** (`twitch-extension/`) — Video Overlay + Config view. Listens for PubSub broadcasts, falls back to polling KV, renders a deck/relics/potions/combat UI styled after the in-game cards.

## Repo Layout

| Path                            | What                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `Code/`                         | C# mod source (.NET 9, Godot Mono)                                 |
| `ebs/`                          | Cloudflare Worker + `wrangler.toml`                                |
| `twitch-extension/`             | `video_overlay.html`, `config.html`, `overlay.js`, `config.js`     |
| `docs/`                         | Privacy policy, Terms of Service (hosted URLs in Twitch Dashboard) |
| `release/SpireScryer/`          | Streamer-facing README + `spirescryer_config.txt.example`          |
| `overlay.html`                  | Self-contained local test overlay (no Twitch SDK) for development  |
| `SpireScryer.{csproj,sln,json}` | .NET project files + Godot mod manifest                            |

## Build (Mod)

Requires .NET 9 SDK and a local copy of Slay the Spire 2. Edit `SpireScryer.csproj` if the game is not at the default Steam path.

```bash
dotnet build -c Release
```

Output: `bin/Release/SpireScryer.dll`.

## Install (Mod — Streamer)

1. Copy `bin/Release/SpireScryer.dll` and `SpireScryer.json` into:
   ```
   <Steam>\steamapps\common\Slay the Spire 2\mods\SpireScryer\
   ```
2. Open the Twitch Extension **Options** panel, click **Generate New Secret**, click **Copy config block**.
3. Paste the block into:
   ```
   %APPDATA%\MegaCrit\SlayTheSpire2\spirescryer_config.txt
   ```

Diagnostic log: `%APPDATA%\MegaCrit\SlayTheSpire2\spirescryer.log` (auto-rotates at 1 MB).

## Deploy (EBS)

```bash
cd ebs
wrangler secret put TWITCH_EXTENSION_SECRET   # base64 "Extension Secret" from Twitch dashboard
wrangler secret put MOD_SHARED_SECRET         # random string — only used server-side
wrangler kv namespace create SPIRE_KV         # put the resulting id in wrangler.toml
wrangler deploy
```

The worker exposes:

- `POST /push` — mod pushes game state here (HMAC-authenticated per channel)
- `GET /state/:channelId` — extension fallback path, returns last known state from KV
- `POST /config/*` — Config-view-only endpoints for secret rotation

## Build (Extension zip)

```bash
cd twitch-extension
# Windows PowerShell
powershell -Command "Compress-Archive -Path config.html,config.js,overlay.js,video_overlay.html -DestinationPath spire-scryer-extension.zip -Force"
```

Upload the zip in the Twitch Extension dashboard. `video_overlay.html` is the viewer-facing overlay; `config.html` is the streamer-facing Config panel.

## Local Development

Open `overlay.html` directly in a browser to iterate on the UI without a running mod — it contains the same markup/styles as `video_overlay.html` but without the Twitch SDK, so you can paste mock state into `currentState` via devtools.

## Service Limitations

The EBS runs on Cloudflare Workers **free tier** (100k requests / 100k KV reads / 1k KV writes per day, account-wide). State updates are hash-deduplicated and broadcast at most every 10 s to stay well under those caps, but extreme concurrent load across many streamers could degrade service. If you plan to run this on a large channel, consider hosting your own EBS.
