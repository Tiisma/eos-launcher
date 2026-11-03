/**
 * The one server this launcher exists for, pinned at build time.
 *
 * Every Sombreterre-specific decision reads from here, so retargeting the launcher (another game
 * version, another server address, another pack origin) is an edit to this file and nothing else.
 * Nothing in it is a secret: the whole object ships inside the app and any player can read it.
 */

export interface SombreterreServer {
  /** Stable bookmark id, so the launch can name the server without depending on its address. */
  id: string
  name: string
  /** Stored without brackets, the form src/domain/servers/bookmarks.ts expects. */
  host: string
  port: number
}

export interface SombreterreProfile {
  /** Display name, used for the Installation and the home screen. */
  name: string
  /** Fixed id of the one Installation the launcher manages. */
  installationId: string
  /** The only game version the launcher installs and launches. */
  gameVersion: string
  /** Whether the build is patched with Optimum. */
  optimum: boolean
  /**
   * The Optimum release installed, pinned like {@link gameVersion} so a new Optimum (for a newer game
   * version, say) never reaches players before the server has moved to it. Empty for the latest.
   */
  optimumVersion: string
  server: SombreterreServer
  /**
   * Whether Play starts the game straight onto {@link server}. Off: the game opens on the server's own
   * main menu (the client mod's startup hook, see src/ipc/sombreterreStartupHook.ts) and the player
   * joins from there, so a first start can change settings, such as the language, and restart first.
   */
  connectOnLaunch: boolean
  /**
   * Base address of the server's gate API (the SombreterreGate module of the server mod), ending
   * with "/". It answers the player count, the Discord link, launch tickets and the pack. Same
   * scheme rule as {@link packManifestUrl}.
   */
  gateBaseUrl: string
  /**
   * Where the pack manifest lives (see src/domain/sombreterre/pack.ts). Private mod files are
   * resolved relative to it and must stay on the same origin. Plain http is accepted for a loopback
   * host only, which is what `npm run pack:serve` provides.
   */
  packManifestUrl: string
  /**
   * Whether the launcher updates itself, from this fork's GitHub releases (electron-builder.yml
   * `publish`). On, the update is mandatory: see src/domain/appUpdate/mandatoryUpdate.ts.
   */
  autoUpdate: boolean
  /** Whether a first start copies a VS Launcher profile in. Off: its Installations are the player's own, not the server's. */
  importLegacyUserData: boolean
  /**
   * Whether players may pick another launcher background. Off: the launcher always paints the
   * bundled src/renderer/src/assets/sombreterre/background.jpg, whatever an older config stored.
   */
  backgroundPicker: boolean
}

export const SOMBRETERRE_PROFILE: SombreterreProfile = {
  name: "The Exiles of Shadowland",
  installationId: "sombreterre",
  gameVersion: "1.22.7",
  optimum: true,
  optimumVersion: "0.3.22",
  server: { id: "sombreterre-server", name: "The Exiles of Shadowland", host: "57.129.112.230", port: 42420 },
  connectOnLaunch: false,
  gateBaseUrl: "https://eos-gate.duckdns.org:8443/",
  packManifestUrl: "https://eos-gate.duckdns.org:8443/api/pack.json",
  autoUpdate: true,
  importLegacyUserData: false,
  backgroundPicker: false
}
