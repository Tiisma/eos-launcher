import { join } from "node:path"
import fse from "fs-extra"
import yauzl from "yauzl"

import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreStartupHook.ts]"

/**
 * The server's client mod carries a .NET startup hook (SombreterreGate.Startup in the gate repository)
 * in its zip, under native/, which the game's mod loader skips. Started with DOTNET_STARTUP_HOOKS
 * pointing at it, the game shows the server's main menu from its first screen, and the player joins
 * with its Play button, after changing settings if they want to.
 *
 * The hook is copied out of the zip after each pack sync, so it always matches the client mod the
 * pack installed, and leaves with it.
 */
export const STARTUP_HOOK_FOLDER = ".eos-startup"
export const STARTUP_HOOK_FILE = "SombreterreGate.Startup.dll"
const STARTUP_HOOK_ENTRY = `native/${STARTUP_HOOK_FILE}`
const CLIENT_MOD_ARCHIVE = /^sombreterregate[^\\/]*\.zip$/i
const MAX_STARTUP_HOOK_BYTES = 4 * 1024 * 1024

/** The hook's bytes out of one archive, or undefined when it has none (or a broken one). Only that one entry is read. */
function readStartupHook(archivePath: string): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return resolve(undefined)
      let settled = false
      const settle = (bytes: Buffer | undefined): void => {
        if (settled) return
        settled = true
        if (zip.isOpen) zip.close()
        resolve(bytes)
      }

      zip.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName !== STARTUP_HOOK_ENTRY) return zip.readEntry()
        if (!(entry.uncompressedSize > 0 && entry.uncompressedSize <= MAX_STARTUP_HOOK_BYTES)) return settle(undefined)
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return settle(undefined)
          const chunks: Buffer[] = []
          let total = 0
          stream.on("data", (chunk: Buffer) => {
            total += chunk.length
            if (total > MAX_STARTUP_HOOK_BYTES) {
              stream.destroy()
              settle(undefined)
              return
            }
            chunks.push(Buffer.from(chunk))
          })
          stream.on("end", () => settle(Buffer.concat(chunks)))
          stream.on("error", () => settle(undefined))
        })
      })
      zip.on("end", () => settle(undefined))
      zip.on("error", () => settle(undefined))
      zip.readEntry()
    })
  })
}

/**
 * Puts the client mod's startup hook in the Installation's {@link STARTUP_HOOK_FOLDER}, or removes the
 * folder when the installed client mod has none. Never fails the launch: without the hook, the game
 * shows its own menu until the player has been on the server once.
 */
export async function installStartupHook(installationPath: string): Promise<void> {
  const folder = join(installationPath, STARTUP_HOOK_FOLDER)
  try {
    const modsFolder = join(installationPath, "Mods")
    const names = (await fse.readdir(modsFolder).catch(() => [] as string[])).filter((name) => CLIENT_MOD_ARCHIVE.test(name))
    let bytes: Buffer | undefined
    for (const name of names) {
      bytes = await readStartupHook(join(modsFolder, name))
      if (bytes) break
    }
    if (!bytes) {
      await fse.remove(folder)
      return
    }
    await fse.ensureDir(folder)
    const target = join(folder, STARTUP_HOOK_FILE)
    const current = await fse.readFile(target).catch(() => undefined)
    if (current?.equals(bytes)) return
    await fse.writeFile(`${target}.tmp`, bytes)
    await fse.move(`${target}.tmp`, target, { overwrite: true })
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [installStartupHook] Could not put the startup hook in place: ${getErrorMessage(error)}`)
  }
}

/** DOTNET_STARTUP_HOOKS for an Installation whose hook is in place (a plain file, not a link), otherwise nothing. */
export async function startupHookEnvironment(installationPath: string): Promise<Record<string, string>> {
  const hook = join(installationPath, STARTUP_HOOK_FOLDER, STARTUP_HOOK_FILE)
  const stat = await fse.lstat(hook).catch(() => undefined)
  return stat?.isFile() ? { DOTNET_STARTUP_HOOKS: hook } : {}
}
