import { ipcMain } from "electron"

import { IPC_CHANNELS } from "@src/ipc/ipcChannels"
import { assertTrustedIpcSender } from "@src/ipc/ipcSecurity"
import { assertConfiguredInstallationPath } from "@src/ipc/pathPolicy"
import { isRecord } from "@src/ipc/validation"
import { clearGameCache } from "@src/ipc/sombreterreCache"
import { chooseOptionalMod, listOptionalMods, syncSombreterrePack } from "@src/ipc/sombreterrePack"
import { getGateAccount, getGateStatus, linkDiscord, prepareLaunchTicket, unlinkDiscord } from "@src/ipc/sombreterreGate"
import { getMetricsConsent, reportLaunch, setMetricsConsent, writeGameConsent } from "@src/ipc/sombreterreMetrics"
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

/**
 * Each click starts a new link and ends the one before (see linkDiscord): a player whose browser
 * crashed, or who closed the tab, is never left waiting on an attempt that cannot finish.
 */
ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.LINK_DISCORD, async (event): Promise<SombreterreLinkResult> => {
  assertTrustedIpcSender(event)
  return linkDiscord()
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
    const safePath = await assertConfiguredInstallationPath(installationPath)
    // The client mod reads the player's metrics answer from the Installation, beside the ticket.
    await writeGameConsent(safePath)
    return await prepareLaunchTicket(safePath)
  } catch {
    return { ok: false, reason: "refused" }
  }
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.METRICS_CONSENT, async (event): Promise<SombreterreMetricsConsent> => {
  assertTrustedIpcSender(event)
  return getMetricsConsent()
})

ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.SET_METRICS_CONSENT, async (event, consent: unknown): Promise<void> => {
  assertTrustedIpcSender(event)
  if (typeof consent !== "boolean") throw new TypeError("Invalid metrics answer")
  await setMetricsConsent(consent)
})

/** Only numbers and short codes cross from the renderer; the hardware is read on this side. */
ipcMain.handle(IPC_CHANNELS.SOMBRETERRE.REPORT_LAUNCH, async (event, launch: unknown): Promise<void> => {
  assertTrustedIpcSender(event)
  if (!isRecord(launch)) return
  const seconds = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400 ? Math.round(value * 10) / 10 : undefined)
  const code = (value: unknown): string | undefined => (typeof value === "string" && /^[a-z0-9._:-]{1,64}$/i.test(value) ? value : undefined)
  const installSeconds = seconds(launch["installSeconds"])
  const syncSeconds = seconds(launch["syncSeconds"])
  const optimumVersion = code(launch["optimumVersion"])
  const launchError = code(launch["launchError"])
  void reportLaunch({
    ...(installSeconds !== undefined ? { installSeconds } : {}),
    ...(syncSeconds !== undefined ? { syncSeconds } : {}),
    ...(optimumVersion ? { optimumVersion } : {}),
    ...(launchError ? { launchError } : {})
  })
})
