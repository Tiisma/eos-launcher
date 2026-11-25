# The Exiles of Shadowland - Launcher: Privacy Policy

Last updated: 2026-11-25 (anonymous metrics, only with your agreement)

This policy explains what information **The Exiles of Shadowland - Launcher** (the "launcher") handles, and what the server's gate, the part of The Exiles of Shadowland game server the launcher talks to, keeps about you. The launcher is a fork of [RiftLauncher](https://github.com/StratumServer/RiftLauncher), maintained for The Exiles of Shadowland roleplay server. Its source code is at [github.com/Tiisma/eos-launcher](https://github.com/Tiisma/eos-launcher), and the gate's at [github.com/Tiisma/eos-gate](https://github.com/Tiisma/eos-gate).

It does not cover Vintage Story, the Vintage Story websites, the ModDB, GitHub, Discord, or any other service the launcher opens or contacts. Those services have their own policies and control the data they receive.

**Who is responsible.** The data the gate keeps is held by the administration of The Exiles of Shadowland server, which you reach through the staff on its Discord. Linking requires a Discord account, so you must be old enough to use Discord where you live.

## Information stored on your device

The launcher keeps its configuration, logs and caches in `%APPDATA%\EoSLauncher` on Windows (`~/.config/EoSLauncher` on Linux). The game itself, its installation and its backups live in the `Versions`, `Installations` and `Backups` folders inside it.

**Vintage Story account.** If you sign in, the launcher sends the email address, password and optional two-factor code you enter to the official Vintage Story account service at `auth3.vintagestory.at` over HTTPS. The password and two-factor code are only held in memory for that request and are never written to disk or to the logs. The response gives your player name, player UID, entitlements and session credentials. The non-secret profile is stored in the configuration; the session key, session signature and multiplayer token are stored encrypted, using the operating system's secure storage through Electron. When you play, the launcher writes the profile and session fields the game needs into the installation's `clientsettings.json`, as the official launcher would; from there they belong to the game installation.

**Discord link.** When you link Discord, the launcher briefly listens on your own computer's loopback address (`127.0.0.1`, unreachable from the network) so your browser can hand the result back to it; the listener closes as soon as linking ends. The launcher then stores the launcher token the gate gives it, and your Discord display name, in an encrypted file (`sombreterre-gate.bin`) using the same secure storage. On a computer without secure storage, the token is kept in memory only and you link again the next time the launcher starts. **Unlink Discord** deletes the file and revokes that token on the gate; it does not remove the link between your Discord and game accounts kept by the gate (see below).

**Launch ticket.** Right before the game starts, the launcher writes a single-use launch ticket to `ModConfig\sombreterre-ticket.json` in the installation. The game's `sombreterregate` client mod reads it, sends it to the game server and deletes the file.

**Logs.** Logs contain operational messages and errors. Recognized passwords, tokens, authorization values and file paths are redacted before writing, but review a log before sharing it. The launcher never uploads logs.

**Your answer to the metrics question.** The launcher keeps it in `sombreterre-metrics.json` beside its configuration, and writes it into the installation's `ModConfig\sombreterre-metrics.json` before each Play, where the `sombreterregate` client mod reads it.

**Mods run code on your computer.** Pressing Play installs the mods the server lists. Like any Vintage Story mod, they are programs that run with your user's rights when the game starts. The launcher checks every archive against the SHA-256 the server publishes, which proves you got what the server lists, not that what it lists is harmless. Only play on a server you trust.

## Requests to external services

- **The Exiles of Shadowland gate** (`eos-gate.duckdns.org`, HTTPS): the home screen asks for the number of players online and, once you are linked, whether your Discord account may play. Linking, launch tickets, the mod pack and the server's own mods are requested from it. The launcher token is sent to this address and nowhere else. If you agreed to anonymous metrics, they are sent here too, without the token (see below).
- **Discord**: linking opens Discord's own authorization page in your browser. You sign in to Discord there, never in the launcher. The launcher only asks for the `identify` scope, which gives the gate your Discord user ID and name.
- **Vintage Story** (`api.vintagestory.at`, `cdn.vintagestory.at`): the list of game versions, read when the home screen opens, and the game download when it is not installed yet.
- **Optimum** (GitHub releases of `StratumServer/Optimum`): the performance patch applied to the game when it is first installed.
- **Vintage Story ModDB** (`mods.vintagestory.at`, `moddbcdn.vintagestory.at`): details and downloads of the public mods the pack lists.
- **The game server** (`57.129.112.230`): the game itself connects to it when you press Play.
- **GitHub** (releases of `Tiisma/eos-launcher`): at startup and every 30 minutes while it is open, the launcher reads the latest release to see whether a newer launcher exists, and downloads it if so. Nothing about you or your account is sent.

These services can receive normal connection metadata, such as your IP address, request times and protocol information. See the [Vintage Story Privacy Policy](https://www.vintagestory.at/privacy/), the [Discord Privacy Policy](https://discord.com/privacy) and the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Anonymous metrics (only if you agree)

The first time the launcher opens, it asks whether you agree to send anonymous technical data to help fix bugs and improve the server. Neither answer is chosen for you, and **nothing is sent until you answer yes**. You can change your answer at any time in the launcher's settings (**Anonymous data**); from then on nothing more is sent.

If you agree:

- **The launcher**, on each Play: its version, the game and Optimum versions, your operating system and its major version, your CPU model and number of threads, your GPU model, your RAM rounded to the gigabyte, how long installing the game and syncing the pack took, and a short code when a launch fails (for example `ticket:not-whitelisted`).
- **The game** (the `sombreterregate` client mod), once per session, ten minutes into play: your frame rate (average and lowest), how long joining took, and the memory the game uses.
- **Crash reports**: after the game closed, if it wrote a crash file during that session, the launcher sends the error type, the mod the game blamed, and the error trace. Before it leaves your computer, the trace is cleaned of file paths, e-mail and IP addresses, tokens, your launcher accounts' names, e-mails and UIDs, and your system user and computer names.

What is never sent: your name, game or Discord account, launcher token, files, worlds, chat or logs other than the cleaned crash trace. The launcher sends these reports without its token, so the gate cannot tie them to an account. The gate keeps only the listed fields (anything else is dropped), cleans crash traces a second time, keeps no IP address with them, rounds their time down to the hour, and does not write their requests to the proxy's log. They are stored on the game server only and **deleted after 30 days**. The staff reads them as a weekly summary (averages, the most common hardware and the most frequent crashes) in a staff-only Discord channel.

Because nothing in them points to you, the staff cannot find or delete your own reports on request; they disappear by themselves after 30 days.

## What the gate keeps about you

The gate runs on The Exiles of Shadowland game server and is operated by its staff. It keeps:

- your **Discord user ID and display name**, and a **SHA-256 digest of your launcher token** (never the token itself), to recognize your launcher;
- the **link between your Discord user ID and your Vintage Story player UID**, created the first time you join through the launcher;
- launch tickets, in memory only, for at most ten minutes;
- an **audit trail** of security events (a launcher linked, a first join, a refused join, a revocation), with your Discord user ID, player name and UID and, for links, your IP address, in the server's log and in a staff-only Discord channel.

When a launcher is linked to your Discord account, the server's bot sends you a direct message, so a link you did not make does not go unnoticed. The reverse proxy in front of the gate logs each request (time, IP address, path) in files kept on the server and rotated after about 100 MB.

It reads your membership of the server's Discord guild and your roles through the server's Discord bot, to decide whether you may play. It does not receive your Discord password, email address or messages through the launcher. The game server and its Discord bot keep their own logs, such as connections and the in-game chat relayed to Discord; those are the server's, not the launcher's.

## What the launcher does not do

It has no advertising and no tracking. The only telemetry is the anonymous metrics above, sent only if you agree. It does not sell personal information and does not send your worlds, backups, mods, logs or configuration files to anyone.

## Retention and deletion

Local data stays on your device until you remove it. Use the account controls to sign out of Vintage Story, and **Unlink Discord** to revoke and delete the launcher token. To remove everything else, close the launcher and delete `%APPDATA%\EoSLauncher` (this also removes the game installed by the launcher).

On the gate, a launcher token stops working and is deleted after 60 days without use, and as soon as you unlink or the staff revokes it. The link between your Discord and game accounts stays until the staff removes it. To see what the gate holds about you, or to have your link, tokens and audit entries removed, ask the server staff on The Exiles of Shadowland Discord.

## Security

The launcher only contacts the gate over HTTPS and refuses plain HTTP to any host other than your own computer. Session credentials and the launcher token are stored with the operating system's secure storage. No software can protect a compromised computer: keep it up to date, and never share passwords, tokens or unreviewed logs.

## Changes and contact

This policy is updated when the launcher's or the gate's data handling changes; the date at the top records the latest revision. For a privacy question, ask the server staff on The Exiles of Shadowland Discord, or open an issue in the [repository](https://github.com/Tiisma/eos-launcher/issues) without including passwords, tokens or private logs. For a security problem, follow [SECURITY.md](SECURITY.md).

## Implementation references

[Account login](src/ipc/handlers/accountHandlers.ts), [encrypted account storage](src/ipc/accountStore.ts), [Discord link and launch tickets](src/ipc/sombreterreGate.ts), [pack sync](src/ipc/sombreterrePack.ts), [anonymous metrics](src/ipc/sombreterreMetrics.ts) and what the gate keeps of them ([MetricsBook.cs](https://github.com/Tiisma/eos-gate/blob/sombreterre-gate/Th3Essentials/Sombreterre/MetricsBook.cs)), [network allow-list](src/ipc/validation.ts), and the gate's [HTTP API](https://github.com/Tiisma/eos-gate/blob/sombreterre-gate/Th3Essentials/Sombreterre/GateHttpApi.cs).
