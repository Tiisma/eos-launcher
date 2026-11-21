import { createHash } from "node:crypto"
import { join } from "node:path"
import fse from "fs-extra"

import { BACKGROUNDS_FOLDER_NAME, BACKGROUNDS_STATE_FILE_NAME, MAX_BACKGROUND_BYTES, parseBackgroundsState, planBackgrounds } from "@domain/sombreterre/backgrounds"
import type { PackBackground } from "@domain/sombreterre/backgrounds"
import { writeJsonAtomic } from "@src/ipc/atomicJsonFile"
import { requestBoundedBuffer } from "@src/ipc/network"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreBackgrounds.ts]"
const BACKGROUND_TIMEOUT_MS = 2 * 60_000

/** Where the gate serves one background: beside the manifest, under backgrounds/, and nowhere else. */
export function backgroundUrl(manifestUrl: URL, file: string): URL | undefined {
  try {
    const url = new URL(`backgrounds/${encodeURIComponent(file)}`, manifestUrl)
    return url.origin === manifestUrl.origin ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * Brings the Installation's backgrounds folder in line with the server's list. Never fails the sync: a
 * picture that does not arrive is tried again at the next Play, and the menu shows the others meanwhile.
 */
export async function syncBackgrounds(installationPath: string, wanted: readonly PackBackground[], manifestUrl: URL, headers: Record<string, string>): Promise<void> {
  const folder = join(installationPath, BACKGROUNDS_FOLDER_NAME)
  const statePath = join(folder, BACKGROUNDS_STATE_FILE_NAME)
  try {
    await fse.ensureDir(folder)
    const state = parseBackgroundsState(await fse.readFile(statePath, "utf8").catch(() => undefined))
    const plan = planBackgrounds(wanted, state, await fse.readdir(folder))

    for (const name of plan.remove) await fse.remove(join(folder, name)).catch(() => undefined)

    const kept: Record<string, string> = Object.fromEntries(wanted.filter((background) => !plan.download.includes(background)).map((background) => [background.file, background.sha256]))
    for (const background of plan.download) {
      const url = backgroundUrl(manifestUrl, background.file)
      if (!url) continue
      try {
        const bytes = await requestBoundedBuffer(url, { accept: "image/*", maxBytes: MAX_BACKGROUND_BYTES, timeoutMs: BACKGROUND_TIMEOUT_MS, headers })
        if (createHash("sha256").update(bytes).digest("hex") !== background.sha256) throw new Error("checksum mismatch")
        await fse.writeFile(join(folder, `${background.file}.tmp`), bytes)
        await fse.move(join(folder, `${background.file}.tmp`), join(folder, background.file), { overwrite: true })
        kept[background.file] = background.sha256
      } catch (error) {
        await fse.remove(join(folder, `${background.file}.tmp`)).catch(() => undefined)
        logMessage("debug", `${LOG_PREFIX} [syncBackgrounds] A background did not arrive: ${getErrorMessage(error)}`)
      }
    }

    await writeJsonAtomic(statePath, kept, { spaces: 2 })
    if (plan.download.length > 0 || plan.remove.length > 0) logMessage("info", `${LOG_PREFIX} [syncBackgrounds] Backgrounds: ${plan.download.length} fetched, ${plan.remove.length} removed.`)
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [syncBackgrounds] Could not update the backgrounds: ${getErrorMessage(error)}`)
  }
}
