import { createHash } from "node:crypto"
import { join } from "node:path"
import fse from "fs-extra"

import {
  BACKGROUNDS_FOLDER_NAME,
  BACKGROUNDS_STATE_FILE_NAME,
  LOGO_FILE_NAME,
  MAX_BACKGROUND_BYTES,
  MAX_MENU_FILE_BYTES,
  MENU_FOLDER_NAME,
  isBackgroundFileName,
  isMenuFileName,
  parseBackgroundsState,
  planBackgrounds
} from "@domain/sombreterre/backgrounds"
import type { PackBackground } from "@domain/sombreterre/backgrounds"
import { writeJsonAtomic } from "@src/ipc/atomicJsonFile"
import { requestBoundedBuffer } from "@src/ipc/network"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreBackgrounds.ts]"
const BACKGROUND_TIMEOUT_MS = 2 * 60_000

/** Where the gate serves one background: beside the manifest, under backgrounds/, and nowhere else. */
export function backgroundUrl(manifestUrl: URL, file: string): URL | undefined {
  return listedFileUrl(manifestUrl, "backgrounds", file)
}

function listedFileUrl(manifestUrl: URL, folder: string, file: string): URL | undefined {
  try {
    const url = new URL(`${folder}/${encodeURIComponent(file)}`, manifestUrl)
    return url.origin === manifestUrl.origin ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * Brings the Installation's copy of the server's logo in line: fetched when it changed, removed when the
 * server has none, so the menu goes back to the game's logo. Like the backgrounds, never fails the sync.
 */
export async function syncLogo(installationPath: string, logo: { sha256: string } | undefined, manifestUrl: URL, headers: Record<string, string>): Promise<void> {
  const path = join(installationPath, LOGO_FILE_NAME)
  try {
    if (!logo) {
      await fse.remove(path)
      return
    }
    const current = await fse.readFile(path).catch(() => undefined)
    if (current && createHash("sha256").update(current).digest("hex") === logo.sha256) return

    const bytes = await requestBoundedBuffer(new URL("logo.png", manifestUrl), { accept: "image/png", maxBytes: MAX_BACKGROUND_BYTES, timeoutMs: BACKGROUND_TIMEOUT_MS, headers })
    if (createHash("sha256").update(bytes).digest("hex") !== logo.sha256) throw new Error("checksum mismatch")
    await fse.writeFile(`${path}.tmp`, bytes)
    await fse.move(`${path}.tmp`, path, { overwrite: true })
    logMessage("info", `${LOG_PREFIX} [syncLogo] Menu logo updated.`)
  } catch (error) {
    await fse.remove(`${path}.tmp`).catch(() => undefined)
    logMessage("warn", `${LOG_PREFIX} [syncLogo] Could not update the menu logo: ${getErrorMessage(error)}`)
  }
}

/**
 * Brings the Installation's backgrounds folder in line with the server's list. Never fails the sync: a
 * picture that does not arrive is tried again at the next Play, and the menu shows the others meanwhile.
 */
export async function syncBackgrounds(installationPath: string, wanted: readonly PackBackground[], manifestUrl: URL, headers: Record<string, string>): Promise<void> {
  await syncListedFolder(
    { installationPath, folderName: BACKGROUNDS_FOLDER_NAME, servedUnder: "backgrounds", label: "Backgrounds", accept: "image/*", maxBytes: MAX_BACKGROUND_BYTES, isAllowedName: isBackgroundFileName },
    wanted,
    manifestUrl,
    headers
  )
}

/** Brings the Installation's menu texts (tips, panel) in line with the server's, the same way as the backgrounds. */
export async function syncMenuFiles(installationPath: string, wanted: readonly PackBackground[], manifestUrl: URL, headers: Record<string, string>): Promise<void> {
  await syncListedFolder(
    { installationPath, folderName: MENU_FOLDER_NAME, servedUnder: "menu", label: "Menu texts", accept: "text/plain", maxBytes: MAX_MENU_FILE_BYTES, isAllowedName: isMenuFileName },
    wanted,
    manifestUrl,
    headers
  )
}

interface ListedFolder {
  installationPath: string
  folderName: string
  /** The gate's path for these files, beside the manifest. */
  servedUnder: string
  label: string
  accept: string
  maxBytes: number
  isAllowedName: (name: string) => boolean
}

/** One folder the launcher owns, holding exactly the files the manifest lists, each checked against its digest. */
async function syncListedFolder(options: ListedFolder, wanted: readonly PackBackground[], manifestUrl: URL, headers: Record<string, string>): Promise<void> {
  const folder = join(options.installationPath, options.folderName)
  const statePath = join(folder, BACKGROUNDS_STATE_FILE_NAME)
  try {
    await fse.ensureDir(folder)
    const state = parseBackgroundsState(await fse.readFile(statePath, "utf8").catch(() => undefined), options.isAllowedName)
    const plan = planBackgrounds(wanted, state, await fse.readdir(folder))

    for (const name of plan.remove) await fse.remove(join(folder, name)).catch(() => undefined)

    const kept: Record<string, string> = Object.fromEntries(wanted.filter((entry) => !plan.download.includes(entry)).map((entry) => [entry.file, entry.sha256]))
    for (const entry of plan.download) {
      const url = listedFileUrl(manifestUrl, options.servedUnder, entry.file)
      if (!url) continue
      try {
        const bytes = await requestBoundedBuffer(url, { accept: options.accept, maxBytes: options.maxBytes, timeoutMs: BACKGROUND_TIMEOUT_MS, headers })
        if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("checksum mismatch")
        await fse.writeFile(join(folder, `${entry.file}.tmp`), bytes)
        await fse.move(join(folder, `${entry.file}.tmp`), join(folder, entry.file), { overwrite: true })
        kept[entry.file] = entry.sha256
      } catch (error) {
        await fse.remove(join(folder, `${entry.file}.tmp`)).catch(() => undefined)
        logMessage("debug", `${LOG_PREFIX} [syncListedFolder] ${options.label}: a file did not arrive: ${getErrorMessage(error)}`)
      }
    }

    await writeJsonAtomic(statePath, kept, { spaces: 2 })
    if (plan.download.length > 0 || plan.remove.length > 0) logMessage("info", `${LOG_PREFIX} [syncListedFolder] ${options.label}: ${plan.download.length} fetched, ${plan.remove.length} removed.`)
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [syncListedFolder] ${options.label}: could not update: ${getErrorMessage(error)}`)
  }
}
