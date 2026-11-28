import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_COMPRESSION_LEVEL } from "@domain/config/defaults"
import { createInstallation } from "@domain/installations/create"
import { firstFreeFolder, toFolderPlatform } from "@domain/paths"
import { preferredBuild, shouldApplyOptimum } from "@domain/sombreterre/optimum"
import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { isInterruptedInstall } from "@domain/versions/interruptedInstall"
import { createPathBuilderPort } from "@renderer/adapters/paths"
import { useNotificationsContext } from "@renderer/contexts/NotificationsContext"
import { CONFIG_ACTIONS, useConfigDispatch, useGameVersions, useInstallations, useSettingsConfig, useWaitForSave } from "@renderer/features/config/contexts/ConfigContext"
import { toInstallationType } from "@renderer/features/installations/adapters/create"
import { useEnsurePathExists } from "@renderer/features/installations/hooks/usePathActions"
import { useLaunchGame } from "@renderer/features/launch/hooks/useLaunchGame"
import { useFoldersInUse } from "@renderer/features/versions/hooks/useFoldersInUse"
import { useGameVersionCatalog } from "@renderer/features/versions/hooks/useGameVersionCatalog"
import { useInstallVersion } from "@renderer/features/versions/hooks/useInstallVersion"
import { useOptimumActions } from "@renderer/features/versions/hooks/useOptimumActions"

const LOG_TAG = "[front] [sombreterre] [features/sombreterre/hooks/useSombreterrePlay.ts] [useSombreterrePlay > play]"

export type SombreterrePhase = "idle" | "installing-game" | "updating-optimum" | "preparing-installation" | "syncing-mods" | "playing"

export interface SombreterrePlay {
  phase: SombreterrePhase
  /** Downloads done and planned during `syncing-mods`, once the plan is known. */
  syncProgress: { done: number; total: number } | undefined
  /** False while the game catalog is still loading, which the first install needs. */
  ready: boolean
  play: () => Promise<void>
}

const SERVER_BOOKMARK: ServerBookmarkType = { ...SOMBRETERRE_PROFILE.server, lastLaunched: -1 }

/** The build the profile asks for, preferring an Optimum-patched one when the player wants Optimum and a plain one otherwise. */
function findGameVersion(gameVersions: readonly GameVersionType[], wantOptimum: boolean): GameVersionType | undefined {
  const usable = gameVersions.filter((gv) => gv.version === SOMBRETERRE_PROFILE.gameVersion && !isInterruptedInstall(gv) && !gv._installing && !gv._deleting)
  return preferredBuild(usable, wantOptimum)
}

/** A clock for the anonymous metrics' durations, in seconds. Only read from event handlers. */
function seconds(): number {
  return performance.now() / 1000
}

/** Lets the dispatches of the last step reach the refs below before the next step reads them. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * The single button the Sombreterre home screen offers: make sure the pinned game version is
 * installed, the server's Installation exists and points at it, its Mods match the pack, then start
 * the game straight onto the server.
 *
 * Each step is the launcher's own flow (install, create, launch), driven in sequence. They are
 * long-running and each changes the config, so everything read after an await comes from a ref
 * refreshed on every render rather than from this render's closure.
 */
export function useSombreterrePlay(): SombreterrePlay {
  const { t } = useTranslation()
  const { addNotification } = useNotificationsContext()
  const settings = useSettingsConfig()
  const gameVersions = useGameVersions()
  const installations = useInstallations()
  const foldersInUse = useFoldersInUse()
  const configDispatch = useConfigDispatch()
  const waitForSave = useWaitForSave()
  const ensurePathExists = useEnsurePathExists()
  const installVersion = useInstallVersion()
  const catalog = useGameVersionCatalog()
  const { launchGame } = useLaunchGame()
  const { applyOptimum } = useOptimumActions()
  // The profile can rule Optimum out for everyone; otherwise the player's setting decides (on by default).
  const wantOptimum = SOMBRETERRE_PROFILE.optimum && settings.sombreterreOptimum

  const [phase, setPhase] = useState<SombreterrePhase>("idle")
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | undefined>()

  /** Seconds the game install took during the current Play, for the anonymous metrics. */
  const installSeconds = useRef<number | undefined>(undefined)

  const latest = useRef({ gameVersions, installations, foldersInUse, launchGame, wantOptimum })
  latest.current = { gameVersions, installations, foldersInUse, launchGame, wantOptimum }

  useEffect(() => window.api.sombreterre.onSyncProgress((progress) => setSyncProgress(progress)), [])

  function fail(messageKey: string, values?: Record<string, string>): void {
    addNotification(t(messageKey, values), "error")
  }

  async function ensureGameVersion(): Promise<GameVersionType | undefined> {
    const wanted = latest.current.wantOptimum
    const installed = findGameVersion(latest.current.gameVersions, wanted)
    // With Optimum off, an Optimum build is never found here: a vanilla build is installed beside it instead.
    if (installed) return bringOptimumUpToDate(installed)

    const downloadable = catalog.gameVersions.find((version) => version.version === SOMBRETERRE_PROFILE.gameVersion)
    if (!downloadable) {
      fail(catalog.failed ? "features.sombreterre.catalogUnreachable" : "features.sombreterre.versionUnavailable", { version: SOMBRETERRE_PROFILE.gameVersion })
      return undefined
    }

    let optimum: OptimumManifestInfo | undefined
    if (wanted) {
      const manifest = await window.api.optimumManager.getManifest()
      if (manifest.ok && manifest.manifest.supportedGameVersions.includes(SOMBRETERRE_PROFILE.gameVersion)) optimum = manifest.manifest
      else addNotification(t("features.sombreterre.optimumUnavailable", { version: SOMBRETERRE_PROFILE.gameVersion }), "warning")
    }

    const name = optimum ? `${SOMBRETERRE_PROFILE.gameVersion}-optimum` : SOMBRETERRE_PROFILE.gameVersion
    const folder = firstFreeFolder(await createPathBuilderPort().join([settings.defaultVersionsFolder, name]), latest.current.foldersInUse)

    setPhase("installing-game")
    const installStarted = seconds()
    if (!(await installVersion(downloadable, folder, optimum, { stayOnPage: true }))) return undefined
    installSeconds.current = seconds() - installStarted

    await nextFrame()
    return findGameVersion(latest.current.gameVersions, latest.current.wantOptimum)
  }

  /**
   * Brings an installed build to the Optimum version the profile pins, so changing the pin in a launcher
   * update reaches players who installed the game long ago. When the manifest cannot be had, or the patch
   * fails (it has already said why), the build is played as it is: Optimum's patcher refuses before writing
   * and rolls back what it wrote, so a failed update leaves the previous Optimum working.
   */
  async function bringOptimumUpToDate(installed: GameVersionType): Promise<GameVersionType | undefined> {
    if (!latest.current.wantOptimum) return installed

    const manifest = await window.api.optimumManager.getManifest()
    if (!manifest.ok || !shouldApplyOptimum(installed.variant, installed.version, manifest.manifest)) return installed

    window.api.utils.logMessage("info", `${LOG_TAG} Bringing Optimum to ${manifest.manifest.optimumVersion}.`)
    setPhase("updating-optimum")
    const updated = await applyOptimum({ id: installed.id, path: installed.path, version: installed.version }, manifest.manifest)
    if (!updated) window.api.utils.logMessage("warn", `${LOG_TAG} Optimum not updated; playing the installed build.`)

    await nextFrame()
    return findGameVersion(latest.current.gameVersions, latest.current.wantOptimum)
  }

  async function ensureInstallation(gameVersion: GameVersionType): Promise<InstallationType | undefined> {
    setPhase("preparing-installation")
    const existing = latest.current.installations.find((installation) => installation.id === SOMBRETERRE_PROFILE.installationId)

    if (existing) {
      const bookmark = existing.servers?.find((server) => server.id === SERVER_BOOKMARK.id)
      const bookmarkCurrent = bookmark !== undefined && bookmark.host === SERVER_BOOKMARK.host && bookmark.port === SERVER_BOOKMARK.port && bookmark.name === SERVER_BOOKMARK.name
      if (existing.gameVersionId === gameVersion.id && bookmarkCurrent) return existing

      const servers = [{ ...SERVER_BOOKMARK, lastLaunched: bookmark?.lastLaunched ?? -1 }]
      const saved = waitForSave((config) => config.installations.some((installation) => installation.id === existing.id && installation.gameVersionId === gameVersion.id))
      configDispatch({ type: CONFIG_ACTIONS.EDIT_INSTALLATION, payload: { id: existing.id, updates: { version: gameVersion.version, gameVersionId: gameVersion.id, servers } } })
      if (!(await saved)) return undefined
      return { ...existing, version: gameVersion.version, gameVersionId: gameVersion.id, servers }
    }

    const path = firstFreeFolder(await createPathBuilderPort().join([settings.defaultInstallationsFolder, SOMBRETERRE_PROFILE.name]), latest.current.foldersInUse)
    const created = createInstallation(
      { ids: { newId: () => SOMBRETERRE_PROFILE.installationId } },
      {
        name: SOMBRETERRE_PROFILE.name,
        icon: "temporal",
        path,
        version: gameVersion.version,
        gameVersionId: gameVersion.id,
        startParams: "",
        backupsLimit: 3,
        backupsAuto: false,
        compressionLevel: DEFAULT_COMPRESSION_LEVEL,
        mesaGlThread: false,
        envVars: "",
        foldersInUse: latest.current.foldersInUse,
        configuredFolders: [settings.defaultInstallationsFolder, settings.defaultVersionsFolder],
        platform: toFolderPlatform(await window.api.utils.getOs())
      }
    )
    if (!created.ok) {
      window.api.utils.logMessage("error", `${LOG_TAG} Could not build the Sombreterre Installation: ${created.reason}.`)
      return undefined
    }
    if (!(await ensurePathExists(path))) return undefined

    const installation: InstallationType = { ...toInstallationType(created.installation), servers: [SERVER_BOOKMARK] }
    const saved = waitForSave((config) => config.installations.some((candidate) => candidate.id === installation.id))
    configDispatch({ type: CONFIG_ACTIONS.ADD_INSTALLATION, payload: installation })
    if (!(await saved)) return undefined
    return installation
  }

  async function play(): Promise<void> {
    if (phase !== "idle") return

    installSeconds.current = undefined
    let syncSeconds: number | undefined
    let optimumVersion: string | undefined
    // Anonymous, and only sent when the player agreed: durations and a short failure code, nothing else.
    let reported = false
    const report = (launchError?: string): void => {
      if (reported) return
      reported = true
      void window.api.sombreterre.reportLaunch({
        ...(installSeconds.current !== undefined ? { installSeconds: installSeconds.current } : {}),
        ...(syncSeconds !== undefined ? { syncSeconds } : {}),
        ...(optimumVersion ? { optimumVersion } : {}),
        ...(launchError ? { launchError } : {})
      })
    }

    try {
      const gameVersion = await ensureGameVersion()
      if (!gameVersion) return report("game-install")
      optimumVersion = gameVersion.variant?.version

      const installation = await ensureInstallation(gameVersion)
      if (!installation) {
        report("installation")
        return fail("features.sombreterre.installationFailed")
      }

      setPhase("syncing-mods")
      setSyncProgress(undefined)
      const syncStarted = seconds()
      const synced = await window.api.sombreterre.syncPack(installation.path)
      syncSeconds = seconds() - syncStarted
      if (!synced.ok) {
        report(`sync:${synced.reason}`)
        return fail(`features.sombreterre.syncFailed.${synced.reason}`, { modid: synced.modid ?? "" })
      }

      // Fetched last, right before the game starts: an unused ticket expires, and a new one replaces it.
      const ticket = await window.api.sombreterre.prepareLaunch(installation.path)
      if (!ticket.ok) {
        report(`ticket:${ticket.reason}`)
        return fail(`features.sombreterre.ticketFailed.${ticket.reason}`)
      }
      report()

      setPhase("playing")
      await nextFrame()
      const current = latest.current.installations.find((candidate) => candidate.id === installation.id) ?? installation
      // Without a server, the game opens on the server's main menu and the player joins from its Play button.
      await latest.current.launchGame(current, SOMBRETERRE_PROFILE.connectOnLaunch ? SERVER_BOOKMARK.id : undefined)
    } catch (err) {
      window.api.utils.logMessage("error", `${LOG_TAG} Error preparing the game.`)
      window.api.utils.logMessage("debug", `${LOG_TAG} Error preparing the game: ${err}`)
      report("unexpected")
      fail("features.sombreterre.unexpectedError")
    } finally {
      setPhase("idle")
      setSyncProgress(undefined)
    }
  }

  return { phase, syncProgress, ready: !catalog.loading || findGameVersion(gameVersions, wantOptimum) !== undefined, play }
}
