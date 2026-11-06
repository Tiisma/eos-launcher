import { join } from "node:path"
import fse from "fs-extra"

import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { getConfig } from "@src/config/configManager"
import { tryAcquireInstallationOperation } from "@src/ipc/installationActivity"
import { assertConfiguredInstallationPath } from "@src/ipc/pathPolicy"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreCache.ts]"

/** The game's cache folder, which it fills again by itself. Worlds, settings and Mods live elsewhere. */
export const GAME_CACHE_FOLDER = "Cache"

/**
 * Deletes the Cache folder of the server's Installation. The folder comes from the configuration and
 * nothing from the renderer, so this can reach no other. Refused while the game runs: it has files in
 * there open. A game started outside the launcher is caught by those same files refusing to go.
 */
export async function clearGameCache(): Promise<SombreterreClearCacheResult> {
  const config = await getConfig()
  const installation = config.installations.find((candidate) => candidate.id === SOMBRETERRE_PROFILE.installationId)
  if (!installation) return { ok: true }

  const lease = tryAcquireInstallationOperation([installation.id])
  if (!lease.ok) return { ok: false, reason: lease.reason }
  try {
    const safePath = await assertConfiguredInstallationPath(installation.path)
    await fse.remove(join(safePath, GAME_CACHE_FOLDER))
    logMessage("info", `${LOG_PREFIX} [clearGameCache] Game cache deleted.`)
    return { ok: true }
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [clearGameCache] Could not delete the game cache: ${getErrorMessage(error)}`)
    return { ok: false, reason: "failed" }
  } finally {
    lease.release()
  }
}
