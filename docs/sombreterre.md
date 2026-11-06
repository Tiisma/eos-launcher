# Sombreterre launcher

This repository is a local fork of [RiftLauncher](https://github.com/StratumServer/RiftLauncher) (MIT) for the Sombreterre roleplay server. The upstream remote is named `upstream`; there is no `origin` yet.

## What the fork changes

- **One screen.** The side menu is gone. The home screen shows the server name over the launcher background and a single **Play** button, plus the account button, the activity center and a settings link. Every other page is still routed, just not linked from the home screen.
- **One game version.** Play installs Vintage Story `1.22.7` if it is missing, patched with Optimum `0.3.22` (pinned in the profile, like the game version, so a newer Optimum never reaches players before the server moves to it).
- **One Installation.** Play creates (or repairs) the `Sombreterre` Installation, pointed at that build, with the server saved as its only bookmark.
- **One pack.** Before each launch, the Installation's `Mods` folder is synced with the pack manifest: ModDB Mods at pinned versions, plus private Mods served next to the manifest.
- **Discord gate.** Until the launcher is linked to a Discord account, the home screen offers "Link my Discord" instead of Play. Play stays locked until the server says that account is whitelisted. The home screen also shows the players online.
- **Whitelist from the Discord role.** The ticket request names the game account (the launcher's active account, otherwise the one logged in inside the game), so a player holding the role is on the server's whitelist before the game starts. If no account is known yet, Play asks the player to log in with the account button.
- **Clear Cache.** A button on the home screen deletes the installation's `Cache` folder after asking, unless the game is running. The game rebuilds it.
- **Optional mods.** The pack manifest can offer mods players may add (`optional`). The home screen lists them; a choice applies at the next Play. Anything else found in the installation's `Mods` folder is moved to `Mods-disabled/`.
- **A valid ticket for as long as the game runs.** While the game is open, the launcher asks for a new ticket at half the previous one's life and overwrites the file the client mod reads, so the menu's Play button keeps working. This stops if the launcher is closed.
- **The server's main menu.** Right before the game starts, the launcher fetches a launch ticket and writes it, with the server address, to `<Installation>/ModConfig/sombreterre-ticket.json`, where the `sombreterregate` client mod picks it up. After each pack sync it copies the client mod's startup hook (`native/SombreterreGate.Startup.dll` in the mod's zip) to `<Installation>/.eos-startup/`, and starts the game with `DOTNET_STARTUP_HOOKS` pointing at it. The game then opens on the server's own menu (Play, Creative world, Settings, Quit) and the player joins with Play when ready, after changing settings first if they want to. `connectOnLaunch` in `src/domain/sombreterre/profile.ts` brings back the direct connection (`-c <host:port>`).
- **Mandatory self-update.** The launcher updates itself from this fork's GitHub releases (`Tiisma/eos-launcher`), without asking. See [Launcher updates](#launcher-updates).
- **Isolated from RiftLauncher.** Named "The Exiles of Shadowland - Launcher" (`EoSLauncher.exe`), with its own app id and its own folder, `%APPDATA%\EoSLauncher`, which also holds the game folders (`Installations`, `Versions`, `Backups`) instead of placing them beside RiftLauncher's in `%APPDATA%`. The upstream release feed is gone, and so are the ModDB listing prompt, the release notes dialog and the global mod update checker.

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

## Launcher updates

The feed is set in `electron-builder.yml` (`publish`: GitHub, `Tiisma/eos-launcher`) and baked into the installed app's `resources/app-update.yml`. The logic is [`src/main/mandatoryUpdater.ts`](../src/main/mandatoryUpdater.ts), with the decisions in [`src/domain/appUpdate/mandatoryUpdate.ts`](../src/domain/appUpdate/mandatoryUpdate.ts). The update is mandatory: an outdated launcher cannot start the game.

- **When.** At startup, then every 30 minutes while the launcher is open. Only GitHub's "latest release" counts: never a draft, never a prerelease (a tag with a `-`). The version must be strictly newer than the running one, by semver.
- **Startup.** Play waits for the first check, at most 20 seconds, with "Checking for a launcher update…" under it.
- **No network.** If the check fails (offline, GitHub down, no published release carrying `latest.yml`), the failure is logged and Play stays available.
- **Update found.** It downloads straight away; the home screen shows the progress and Play is disabled with "Updating the launcher…".
- **Download fails.** Two more attempts (after 5 s and 30 s). Then the home screen offers **Retry** and **Download it by hand** (the latest release page); Play stays disabled. The next periodic check also tries again.
- **Game running.** The update is never installed while the game (or a backup, a download, anything that holds the launcher open) is running: it waits for it to end.
- **Install.** A 10-second countdown (with **Restart now**), then the installer runs silently and starts the launcher again. A launcher closed during the wait installs the update as it quits.

The installer is not code-signed. electron-updater only verifies a signature when `app-update.yml` has a `publisherName`, which electron-builder writes for signed builds only, so the unsigned update is accepted; its SHA-512 from `latest.yml` is still checked.

### Releasing

1. Bump `version` in `package.json`, commit, then push a `v<version>` tag. The release workflow builds the installer and attaches it, with its `.blockmap`, `latest.yml` and `SHA256SUMS.txt`, to a **draft** release.
2. Review the draft, then publish it. Installed launchers see it from that moment (within 30 minutes for one already open).

Launchers released before the self-update (0.1.1 and older) do not check for updates: their players must install the first version with it by hand, once.

## Known limits

- Private Mods are only as private as the place serving them: anyone with the launcher can read the manifest URL and fetch the archives. Access control, if needed, belongs on the hosting side (and not as a token embedded in the launcher).
- A hand-placed copy of a pack Mod under another file name is not detected, so the game sees a duplicate.
- Optimum is only applied when the game is first installed through Play. An existing vanilla `1.22.7` build is used as is.
- The settings page is the inherited one, with all of its options.
- The legacy VS Launcher data import inherited from RiftLauncher is still active.

## The Discord gate

The server side is the `SombreterreGate` module of the server mod, in the `sombreterre-gate` repository (see its `SOMBRETERRE.md`). The launcher side is [`src/ipc/sombreterreGate.ts`](../src/ipc/sombreterreGate.ts), reached at the profile's `gateBaseUrl`:

- **Linking:** the launcher opens a one-time listener on `127.0.0.1` (random port), creates a link session with the SHA-256 of a random verifier and that port, and opens the gate's start page in the browser (Discord's own consent page follows). After Discord, the gate redirects the browser to the listener with a handoff code (RFC 8252); the launcher then polls with the verifier and the handoff, and only then does the gate mint a launcher token. A start link shared with someone else sends their browser back to their own computer, so the sender never gets a token. The token is stored encrypted with the OS keyring (`safeStorage`) in `sombreterre-gate.bin` under the user data folder, and never written in clear: without a keyring, the link lasts for the session only.
- **The token is sent to the gate's origin only**, as a bearer header: the account check, the ticket request, the pack manifest and the private archives. ModDB downloads never carry it.
- **Every gate request carries `X-EoS-Launcher-Version`.** The gate refuses launchers older than its `MinLauncherVersion` (HTTP 426), and the player is told to install the latest release. A gate in lockdown answers 423, a rate-limited link 429; each has its own message.
- **ModDB entries can be pinned:** when the manifest gives a `sha256` for a ModDB mod, the downloaded file must match it.
- **Unlinking** revokes the token on the server and deletes it locally.
- The profile's `packManifestUrl` now points at the gate (`api/pack.json`). `npm run pack:serve` still works for testing without the server: point `packManifestUrl` back at `http://127.0.0.1:8787/pack.json` (the gate checks, tickets and Discord link still need the server).
