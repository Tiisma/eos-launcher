import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_COMPRESSION_LEVEL } from "@domain/config/defaults"
import { createInstallation } from "@domain/installations/create"
import { firstFreeFolder, toFolderPlatform } from "@domain/paths"
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

const LOG_TAG = "[front] [sombreterre] [features/sombreterre/hooks/useSombreterrePlay.ts] [useSombreterrePlay > play]"

export type SombreterrePhase = "idle" | "installing-game" | "preparing-installation" | "syncing-mods" | "playing"

export interface SombreterrePlay {
  phase: SombreterrePhase
  /** Downloads done and planned during `syncing-mods`, once the plan is known. */
  syncProgress: { done: number; total: number } | undefined
  /** False while the game catalog is still loading, which the first install needs. */
  ready: boolean
  play: () => Promise<void>
}

const SERVER_BOOKMARK: ServerBookmarkType = { ...SOMBRETERRE_PROFILE.server, lastLaunched: -1 }

/** The build the profile asks for, preferring an Optimum-patched one when the profile wants Optimum. */
function findGameVersion(gameVersions: readonly GameVersionType[]): GameVersionType | undefined {
  const usable = gameVersions.filter((gv) => gv.version === SOMBRETERRE_PROFILE.gameVersion && !isInterruptedInstall(gv) && !gv._installing && !gv._deleting)
  if (!SOMBRETERRE_PROFILE.optimum) return usable.find((gv) => !gv.variant) ?? usable[0]
  return usable.find((gv) => gv.variant?.name === "Optimum") ?? usable[0]
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

  const [phase, setPhase] = useState<SombreterrePhase>("idle")
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | undefined>()

  const latest = useRef({ gameVersions, installations, foldersInUse, launchGame })
  latest.current = { gameVersions, installations, foldersInUse, launchGame }

  useEffect(() => window.api.sombreterre.onSyncProgress((progress) => setSyncProgress(progress)), [])

  function fail(messageKey: string, values?: Record<string, string>): void {
    addNotification(t(messageKey, values), "error")
  }

  async function ensureGameVersion(): Promise<GameVersionType | undefined> {
    const installed = findGameVersion(latest.current.gameVersions)
    if (installed) return installed

    const downloadable = catalog.gameVersions.find((version) => version.version === SOMBRETERRE_PROFILE.gameVersion)
    if (!downloadable) {
      fail(catalog.failed ? "features.sombreterre.catalogUnreachable" : "features.sombreterre.versionUnavailable", { version: SOMBRETERRE_PROFILE.gameVersion })
      return undefined
    }

    let optimum: OptimumManifestInfo | undefined
    if (SOMBRETERRE_PROFILE.optimum) {
      const manifest = await window.api.optimumManager.getManifest()
      if (manifest.ok && manifest.manifest.supportedGameVersions.includes(SOMBRETERRE_PROFILE.gameVersion)) optimum = manifest.manifest
      else addNotification(t("features.sombreterre.optimumUnavailable", { version: SOMBRETERRE_PROFILE.gameVersion }), "warning")
    }

    const name = optimum ? `${SOMBRETERRE_PROFILE.gameVersion}-optimum` : SOMBRETERRE_PROFILE.gameVersion
    const folder = firstFreeFolder(await createPathBuilderPort().join([settings.defaultVersionsFolder, name]), latest.current.foldersInUse)

    setPhase("installing-game")
    if (!(await installVersion(downloadable, folder, optimum, { stayOnPage: true }))) return undefined

    await nextFrame()
    return findGameVersion(latest.current.gameVersions)
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

    try {
      const gameVersion = await ensureGameVersion()
      if (!gameVersion) return

      const installation = await ensureInstallation(gameVersion)
      if (!installation) return fail("features.sombreterre.installationFailed")

      setPhase("syncing-mods")
      setSyncProgress(undefined)
      const synced = await window.api.sombreterre.syncPack(installation.path)
      if (!synced.ok) return fail(`features.sombreterre.syncFailed.${synced.reason}`, { modid: synced.modid ?? "" })

      // Fetched last, right before the game starts: an unused ticket expires, and a new one replaces it.
      const ticket = await window.api.sombreterre.prepareLaunch(installation.path)
      if (!ticket.ok) return fail(`features.sombreterre.ticketFailed.${ticket.reason}`)

      setPhase("playing")
      await nextFrame()
      const current = latest.current.installations.find((candidate) => candidate.id === installation.id) ?? installation
      // Without a server, the game opens on the server's main menu and the player joins from its Play button.
      await latest.current.launchGame(current, SOMBRETERRE_PROFILE.connectOnLaunch ? SERVER_BOOKMARK.id : undefined)
    } catch (err) {
      window.api.utils.logMessage("error", `${LOG_TAG} Error preparing the game.`)
      window.api.utils.logMessage("debug", `${LOG_TAG} Error preparing the game: ${err}`)
      fail("features.sombreterre.unexpectedError")
    } finally {
      setPhase("idle")
      setSyncProgress(undefined)
    }
  }

  return { phase, syncProgress, ready: !catalog.loading || findGameVersion(gameVersions) !== undefined, play }
}
