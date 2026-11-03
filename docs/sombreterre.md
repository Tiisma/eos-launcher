# Sombreterre launcher

This repository is a local fork of [RiftLauncher](https://github.com/StratumServer/RiftLauncher) (MIT) for the Sombreterre roleplay server. The upstream remote is named `upstream`; there is no `origin` yet.

## What the fork changes

- **One screen.** The side menu is gone. The home screen shows the server name over the launcher background and a single **Play** button, plus the account button, the activity center and a settings link. Every other page is still routed, just not linked from the home screen.
- **One game version.** Play installs Vintage Story `1.22.7` if it is missing, patched with the latest Optimum release when that release supports `1.22.7` (otherwise the official build, with a warning).
- **One Installation.** Play creates (or repairs) the `Sombreterre` Installation, pointed at that build, with the server saved as its only bookmark.
- **One pack.** Before each launch, the Installation's `Mods` folder is synced with the pack manifest: ModDB Mods at pinned versions, plus private Mods served next to the manifest.
- **Discord gate.** Until the launcher is linked to a Discord account, the home screen offers "Link my Discord" instead of Play. Play stays locked until the server says that account is whitelisted. The home screen also shows the players online.
- **Straight to the server.** Right before the game starts, the launcher fetches a single-use launch ticket and writes it to `<Installation>/ModConfig/sombreterre-ticket.json`, where the `sombreterregate` client mod picks it up. The game starts with `-c <host:port>`, so it connects to the server without the game's own main menu.
- **Isolated from RiftLauncher.** Named "The Exiles of Shadowland - Launcher" (`EoSLauncher.exe`), with its own app id and its own folder, `%APPDATA%\EoSLauncher`, which also holds the game folders (`Installations`, `Versions`, `Backups`) instead of placing them beside RiftLauncher's in `%APPDATA%`. The self-update and the upstream release feed are off, and so are the ModDB listing prompt, the release notes dialog and the global mod update checker.

Everything specific to the server lives in [`src/domain/sombreterre/profile.ts`](../src/domain/sombreterre/profile.ts): name, game version, Optimum on/off, server address and the pack manifest URL. The Early Access build points at `57.129.112.230:42420`, with the gate behind `https://eos-gate.duckdns.org:8443/`.

## The pack manifest

Parsed by [`src/domain/sombreterre/pack.ts`](../src/domain/sombreterre/pack.ts), synced by [`src/ipc/sombreterrePack.ts`](../src/ipc/sombreterrePack.ts).

```json
{
  "format": 1,
  "name": "Sombreterre",
  "gameVersion": "1.22.7",
  "mods": [
    { "source": "moddb", "modid": "examplemod", "version": "1.0.0" },
    { "source": "private", "modid": "sombreterrecore", "version": "0.1.0", "file": "sombreterrecore-0.1.0.zip", "sha256": "<64 hex>" }
  ]
}
```

- `moddb`: resolved through `https://mods.vintagestory.at/api/mod/<modid>` to the release whose `modversion` is exactly `version`.
- `private`: a `.zip` in the same folder as the manifest, by file name only. The SHA-256 is required and checked.
- The whole manifest is refused if one entry is invalid, if two entries share a modid, or if `gameVersion` differs from the profile.
- Every entry is resolved before anything is written. Archives are downloaded, hash-checked and zip-validated in a scratch folder, then moved into `Mods`.
- The launcher records what it installed in `<Installation>/sombreterre-pack.json` and only ever removes files it installed. Mods the player added by hand are left alone.

Allowed manifest URLs: `https://` anywhere, or `http://` on `127.0.0.1`, `localhost` or `[::1]`. Private archives must stay on the manifest's origin, and redirects are refused.

## Working locally

```bash
npm ci
npm run pack:serve        # serves ./pack on http://127.0.0.1:8787/
npm run dev               # in another terminal
```

To add a private Mod, copy its archive into `pack/` (archives there are git-ignored) and run:

```bash
npm run pack:hash -- pack/sombreterrecore-0.1.0.zip
```

Then paste the printed entry into `pack/pack.json` and fill in `modid` and `version`. `pack/pack.example.json` shows both kinds of entry.

The background is `src/renderer/src/assets/sombreterre/background.jpg` (the Sombreterre artwork, 1920×1080). It is the only one: the background picker is hidden and any stored choice is ignored, unless `backgroundPicker` is turned on in the profile.

## Known limits

- Private Mods are only as private as the place serving them: anyone with the launcher can read the manifest URL and fetch the archives. Access control, if needed, belongs on the hosting side (and not as a token embedded in the launcher).
- A hand-placed copy of a pack Mod under another file name is not detected, so the game sees a duplicate.
- Optimum is only applied when the game is first installed through Play. An existing vanilla `1.22.7` build is used as is.
- The settings page is the inherited one, with all of its options.
- The legacy VS Launcher data import inherited from RiftLauncher is still active.

## The Discord gate

The server side is the `SombreterreGate` module of the server mod, in the `sombreterre-gate` repository (see its `SOMBRETERRE.md`). The launcher side is [`src/ipc/sombreterreGate.ts`](../src/ipc/sombreterreGate.ts), reached at the profile's `gateBaseUrl`:

- **Linking:** the launcher creates a link session with the SHA-256 of a random verifier, opens the gate's start page in the browser (Discord's own consent page follows), then polls with the verifier until the gate hands over a launcher token. The token is stored encrypted with the OS keyring (`safeStorage`) in `sombreterre-gate.bin` under the user data folder, and never written in clear: without a keyring, the link lasts for the session only.
- **The token is sent to the gate's origin only**, as a bearer header: the account check, the ticket request, the pack manifest and the private archives. ModDB downloads never carry it.
- **Unlinking** revokes the token on the server and deletes it locally.
- The profile's `packManifestUrl` now points at the gate (`api/pack.json`). `npm run pack:serve` still works for testing without the server: point `packManifestUrl` back at `http://127.0.0.1:8787/pack.json` (the gate checks, tickets and Discord link still need the server).
