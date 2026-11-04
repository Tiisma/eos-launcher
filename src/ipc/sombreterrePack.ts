import { app } from "electron"
import { createHash } from "node:crypto"
import { join } from "node:path"
import fse from "fs-extra"

import { parseModDetailResponse } from "@domain/mods/moddb"
import { PACK_STATE_FILE_NAME, foreignModNames, installedModDbFile, packStateFor, parsePackManifest, parsePackState, planPackSync, privateFileUrl, resolveModDbRelease } from "@domain/sombreterre/pack"
import type { PackEntry, PackManifest, ResolvedPackFile } from "@domain/sombreterre/pack"
import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { writeJsonAtomic } from "@src/ipc/atomicJsonFile"
import { BoundedResponseError, requestBoundedBuffer, requestBoundedText } from "@src/ipc/network"
import { allowedSombreterreUrl, gateRequestHeaders, isGateOrigin } from "@src/ipc/sombreterreGate"
import { installStartupHook } from "@src/ipc/sombreterreStartupHook"
import { MODS_API_TIMEOUT_MS } from "@src/ipc/validation"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterrePack.ts]"

/** Largest single Mod archive a sync accepts. Generous: real Mods are a few MiB, asset packs a few hundred. */
const MAX_PACK_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_PACK_MANIFEST_BYTES = 1024 * 1024
const ARCHIVE_TIMEOUT_MS = 10 * 60_000

/** Scratch folder for archives on their way in, inside the Installation but outside Mods. */
const DOWNLOAD_FOLDER_NAME = ".sombreterre-download"

/** Where a Mod the server does not offer ends up, inside the Installation but out of the game's sight. */
const FOREIGN_MODS_FOLDER_NAME = "Mods-disabled"

/** Which optional Mods this player chose. In the launcher's own data, since it outlives any one Installation. */
const OPTIONAL_CHOICES_FILE_NAME = "sombreterre-optional.json"

export type PackSyncProgress = { done: number; total: number }

/** The manifest address, read off the profile and never off the renderer. */
function packManifestUrl(): URL | undefined {
  return allowedSombreterreUrl(SOMBRETERRE_PROFILE.packManifestUrl)
}

/** The launcher token and version go to the gate's own origin and nowhere else (ModDB never sees them). */
async function headersFor(url: URL): Promise<Record<string, string>> {
  return isGateOrigin(url) ? gateRequestHeaders() : {}
}

async function resolveEntry(entry: PackEntry, manifestUrl: URL): Promise<ResolvedPackFile | PackSyncFailure> {
  if (entry.source === "private") {
    const url = privateFileUrl(manifestUrl.toString(), entry.file)
    if (!url) return { ok: false, reason: "bad-manifest", modid: entry.modid }
    return { modid: entry.modid, version: entry.version, source: "private", fileName: entry.file, url, sha256: entry.sha256 }
  }

  let text: string
  try {
    text = await requestBoundedText(new URL(`https://mods.vintagestory.at/api/mod/${encodeURIComponent(entry.modid)}`), { timeoutMs: MODS_API_TIMEOUT_MS })
  } catch (error) {
    logMessage("debug", `${LOG_PREFIX} [resolveEntry] ModDB lookup failed: ${getErrorMessage(error)}`)
    return { ok: false, reason: "moddb-unreachable", modid: entry.modid }
  }

  const detail = parseModDetailResponse(text)
  const resolved = detail.ok ? resolveModDbRelease(detail.payload.releases, entry) : undefined
  return resolved ?? { ok: false, reason: "moddb-release-missing", modid: entry.modid }
}

function isFailure(value: ResolvedPackFile | PackSyncFailure): value is PackSyncFailure {
  return "ok" in value
}

async function downloadInto(file: ResolvedPackFile, scratchFolder: string, modsFolder: string): Promise<PackSyncFailure | undefined> {
  let bytes: Buffer
  try {
    const url = new URL(file.url)
    bytes = await requestBoundedBuffer(url, { accept: "*/*", maxBytes: MAX_PACK_ARCHIVE_BYTES, timeoutMs: ARCHIVE_TIMEOUT_MS, headers: await headersFor(url) })
  } catch (error) {
    logMessage("debug", `${LOG_PREFIX} [downloadInto] Download failed: ${getErrorMessage(error)}`)
    return { ok: false, reason: "download-failed", modid: file.modid }
  }

  if (file.sha256 && createHash("sha256").update(bytes).digest("hex") !== file.sha256) return { ok: false, reason: "checksum-mismatch", modid: file.modid }

  const scratchPath = join(scratchFolder, file.fileName)
  try {
    await fse.writeFile(scratchPath, bytes)
    // Imported here rather than at the top: archiveValidation stays off the startup path (tests/main/bootPathImports.test.ts).
    const { validateZipArchive } = await import("@src/ipc/archiveValidation")
    await validateZipArchive(scratchPath)
  } catch (error) {
    logMessage("debug", `${LOG_PREFIX} [downloadInto] Refused archive: ${getErrorMessage(error)}`)
    await fse.remove(scratchPath).catch(() => undefined)
    return { ok: false, reason: "bad-archive", modid: file.modid }
  }

  try {
    await fse.move(scratchPath, join(modsFolder, file.fileName), { overwrite: true })
  } catch (error) {
    logMessage("debug", `${LOG_PREFIX} [downloadInto] Could not place an archive: ${getErrorMessage(error)}`)
    return { ok: false, reason: "write-failed", modid: file.modid }
  }
  return undefined
}

function optionalChoicesPath(): string {
  return join(app.getPath("userData"), OPTIONAL_CHOICES_FILE_NAME)
}

async function readOptionalChoices(): Promise<Set<string>> {
  const raw: unknown = await fse.readJson(optionalChoicesPath()).catch(() => undefined)
  return new Set(Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [])
}

async function fetchManifest(): Promise<PackManifest | undefined> {
  const manifestUrl = packManifestUrl()
  if (!manifestUrl) return undefined
  const text = await requestBoundedText(manifestUrl, { maxBytes: MAX_PACK_MANIFEST_BYTES, headers: await headersFor(manifestUrl) })
  const parsed = parsePackManifest(text)
  return parsed.ok ? parsed.manifest : undefined
}

/** The optional Mods the server offers, with this player's choices. Empty when the server cannot be asked. */
export async function listOptionalMods(): Promise<SombreterreOptionalMod[]> {
  try {
    const manifest = await fetchManifest()
    const chosen = await readOptionalChoices()
    return (manifest?.optional ?? []).map(({ modid, version, name, description }) => ({ modid, version, name, description, chosen: chosen.has(modid) }))
  } catch (error) {
    logMessage("debug", `${LOG_PREFIX} [listOptionalMods] Pack manifest unreachable: ${getErrorMessage(error)}`)
    return []
  }
}

/** Records a player's choice. It takes effect at their next Play, when the pack is synced. */
export async function chooseOptionalMod(modid: string, chosen: boolean): Promise<void> {
  const choices = await readOptionalChoices()
  if (chosen) choices.add(modid)
  else choices.delete(modid)
  await writeJsonAtomic(optionalChoicesPath(), [...choices], { spaces: 2 })
}

/**
 * Brings one Installation's Mods folder in line with the pack.
 *
 * Every entry is resolved before a single file is touched, so a pack that names a release ModDB does
 * not have fails with the folder as it was. Downloads then run one at a time; a failure stops the
 * sync and leaves the state file describing what was there before, so the next run retries the
 * missing archives rather than trusting a half-finished one.
 */
export async function syncSombreterrePack(installationPath: string, onProgress: (progress: PackSyncProgress) => void): Promise<PackSyncResult> {
  const manifestUrl = packManifestUrl()
  if (!manifestUrl) return { ok: false, reason: "bad-manifest-url" }

  let manifestText: string
  try {
    manifestText = await requestBoundedText(manifestUrl, { maxBytes: MAX_PACK_MANIFEST_BYTES, headers: await headersFor(manifestUrl) })
  } catch (error) {
    const status = error instanceof BoundedResponseError ? error.statusCode : undefined
    if (status === 401) return { ok: false, reason: "not-linked" }
    if (status === 403) return { ok: false, reason: "not-whitelisted" }
    if (status === 423) return { ok: false, reason: "locked-down" }
    if (status === 426) return { ok: false, reason: "launcher-outdated" }
    logMessage("warn", `${LOG_PREFIX} [syncSombreterrePack] Pack manifest unreachable: ${getErrorMessage(error)}`)
    return { ok: false, reason: "pack-unreachable" }
  }

  const parsed = parsePackManifest(manifestText)
  if (!parsed.ok) {
    logMessage("warn", `${LOG_PREFIX} [syncSombreterrePack] Pack manifest refused: ${parsed.reason}.`)
    return { ok: false, reason: "bad-manifest" }
  }
  if (parsed.manifest.gameVersion !== SOMBRETERRE_PROFILE.gameVersion) return { ok: false, reason: "game-version-mismatch" }

  const modsFolder = join(installationPath, "Mods")
  const scratchFolder = join(installationPath, DOWNLOAD_FOLDER_NAME)
  const statePath = join(installationPath, PACK_STATE_FILE_NAME)
  const state = parsePackState(await fse.readFile(statePath, "utf8").catch(() => undefined))
  const present = await fse.readdir(modsFolder).catch(() => [] as string[])

  const chosen = await readOptionalChoices()
  const wanted: ResolvedPackFile[] = []
  for (const entry of [...parsed.manifest.mods, ...parsed.manifest.optional.filter((optional) => chosen.has(optional.modid))]) {
    const resolved = (entry.source === "moddb" ? installedModDbFile(entry, state, present) : undefined) ?? (await resolveEntry(entry, manifestUrl))
    if (isFailure(resolved)) return resolved
    wanted.push(resolved)
  }

  try {
    await fse.ensureDir(modsFolder)
    await fse.emptyDir(scratchFolder)
  } catch {
    return { ok: false, reason: "write-failed" }
  }

  const plan = planPackSync(wanted, state, present)

  const total = plan.download.length
  onProgress({ done: 0, total })
  for (const [index, file] of plan.download.entries()) {
    const failure = await downloadInto(file, scratchFolder, modsFolder)
    if (failure) return failure
    onProgress({ done: index + 1, total })
  }

  for (const fileName of plan.remove) await fse.remove(join(modsFolder, fileName)).catch(() => undefined)

  const foreign = foreignModNames(wanted, await fse.readdir(modsFolder).catch(() => [] as string[]))
  for (const name of foreign) {
    await fse.move(join(modsFolder, name), join(installationPath, FOREIGN_MODS_FOLDER_NAME, name), { overwrite: true }).catch((error: unknown) => {
      logMessage("warn", `${LOG_PREFIX} [syncSombreterrePack] Could not move a Mod aside: ${getErrorMessage(error)}`)
    })
  }
  if (foreign.length > 0) logMessage("info", `${LOG_PREFIX} [syncSombreterrePack] ${foreign.length} Mod(s) the server does not offer moved to ${FOREIGN_MODS_FOLDER_NAME}.`)
  await fse.remove(scratchFolder).catch(() => undefined)

  try {
    await writeJsonAtomic(statePath, packStateFor(wanted), { spaces: 2 })
  } catch {
    return { ok: false, reason: "write-failed" }
  }

  await installStartupHook(installationPath)

  logMessage("info", `${LOG_PREFIX} [syncSombreterrePack] Pack in place: ${plan.download.length} downloaded, ${plan.keep.length} kept, ${plan.remove.length} removed.`)
  return { ok: true, downloaded: plan.download.length, kept: plan.keep.length, removed: plan.remove.length }
}
