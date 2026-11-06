import { ipcMain } from "electron"

import { IPC_CHANNELS } from "@src/ipc/ipcChannels"
import { assertTrustedIpcSender } from "@src/ipc/ipcSecurity"
import { assertConfiguredInstallationPath } from "@src/ipc/pathPolicy"
import { clearGameCache } from "@src/ipc/sombreterreCache"
import { chooseOptionalMod, listOptionalMods, syncSombreterrePack } from "@src/ipc/sombreterrePack"
import { getGateAccount, getGateStatus, linkDiscord, prepareLaunchTicket, unlinkDiscord } from "@src/ipc/sombreterreGate"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/handlers/sombreterreHandlers.ts]"

/** Installations with a sync in flight, so a double click never runs two over one Mods folder. */
const syncing = new Set<string>()

/**
 * Syncs the pack into one configured Installation. The renderer names the folder and nothing else:
 * the manifest address, every download URL and every file name come from the profile and the
 * manifest on this side.
 */
ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.SYNC_PACK, async (event, installationPath: unknown): Promise<PackSyncResult> => {
  assertTrustedIpcSender(event)

  let safePath: string
  try {
    safePath = await assertConfiguredInstallationPath(installationPath)
  } catch {
    return { ok: false, reason: "refused" }
  }
  if (syncing.has(safePath)) return { ok: false, reason: "refused" }

  syncing.add(safePath)
  try {
    return await syncSombreterrePack(safePath, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.SOMBRETERRE.SYNC_PROGRESS, progress)
    })
  } catch (error) {
    logMessage("error", `${LOG_PREFIX} [SYNC_PACK] Pack sync failed: ${getErrorMessage(error)}`)
    return { ok: false, reason: "write-failed" }
  } finally {
    syncing.delete(safePath)
  }
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.SERVER_STATUS, async (event): Promise<SombreterreServerStatus> => {
  assertTrustedIpcSender(event)
  return getGateStatus()
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.ACCOUNT_STATE, async (event): Promise<SombreterreAccountState> => {
  assertTrustedIpcSender(event)
  return getGateAccount()
})

/** One link at a time: a second click while the browser is open would only race the first. */
let linking: Promise<SombreterreLinkResult> | null = null

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.LINK_DISCORD, async (event): Promise<SombreterreLinkResult> => {
  assertTrustedIpcSender(event)
  linking ??= linkDiscord().finally(() => {
    linking = null
  })
  return linking
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.UNLINK_DISCORD, async (event): Promise<void> => {
  assertTrustedIpcSender(event)
  await unlinkDiscord()
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.OPTIONAL_MODS, async (event): Promise<SombreterreOptionalMod[] | null> => {
  assertTrustedIpcSender(event)
  return listOptionalMods()
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.CHOOSE_OPTIONAL_MOD, async (event, modid: unknown, chosen: unknown): Promise<void> => {
  assertTrustedIpcSender(event)
  if (typeof modid !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(modid) || typeof chosen !== "boolean") throw new TypeError("Invalid optional mod choice")
  await chooseOptionalMod(modid, chosen)
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.CLEAR_GAME_CACHE, async (event): Promise<SombreterreClearCacheResult> => {
  assertTrustedIpcSender(event)
  return clearGameCache()
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.PREPARE_LAUNCH, async (event, installationPath: unknown): Promise<SombreterreTicketResult> => {
  assertTrustedIpcSender(event)
  try {
    return await prepareLaunchTicket(await assertConfiguredInstallationPath(installationPath))
  } catch {
    return { ok: false, reason: "refused" }
  }
})
