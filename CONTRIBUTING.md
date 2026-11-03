# Contributing

Thanks for helping with The Exiles of Shadowland - Launcher.

## Reporting a problem

Open an issue with what you did, what you expected and what happened instead. Attach the relevant part of the logs from `%APPDATA%\EoSLauncher\Logs` (launcher) or `%APPDATA%\EoSLauncher\Installations\The Exiles of Shadowland\Logs\client-main.log` (game), after checking that they hold no password, token or personal information.

Problems with the server itself (whitelist, roles, mods that misbehave in game) belong on The Exiles of Shadowland Discord, not here.

## Changing the code

1. Install Node.js 22 and run `npm ci`.
2. Make the change on a branch. Code, comments, commit messages and docs are written in English; player-facing text goes in `src/renderer/src/locales/en-US.json` and `fr-FR.json`.
3. Check it: `npm run typecheck`, `npm run lint`, `npm test`.
4. Open a pull request against `eos-launcher` explaining what changed and why.

[`docs/sombreterre.md`](docs/sombreterre.md) explains how the fork works. [`docs/architecture.md`](docs/architecture.md) and the rest of `docs/` describe the code inherited from RiftLauncher, and still apply to it.
