/**
 * The Sombreterre pack: which Mods the server's Installation must hold, and how to get there.
 *
 * One manifest, served over HTTP beside the private archives it names:
 *
 * ```json
 * {
 *   "format": 1,
 *   "name": "Sombreterre",
 *   "gameVersion": "1.22.7",
 *   "mods": [
 *     { "source": "moddb", "modid": "carryon", "version": "1.10.4" },
 *     { "source": "private", "modid": "sombreterrecore", "version": "0.1.0", "file": "sombreterrecore-0.1.0.zip", "sha256": "<64 hex>" }
 *   ]
 * }
 * ```
 *
 * A `moddb` entry is resolved against the ModDB release that carries exactly that version. A
 * `private` entry names an archive next to the manifest, by file name only: it can never point at
 * another host or climb out of the manifest's folder, and its digest is mandatory because nothing
 * else vouches for what that host serves.
 *
 * The launcher only ever touches files it put there itself. What it installed is recorded in a
 * state file beside the Mods folder; a Mod the player dropped in by hand is left alone, which also
 * means a hand-placed copy of a pack Mod under another file name stays a duplicate the game will
 * complain about. That is the player's to remove.
 */

import { isRecord } from "../records"

export const PACK_FORMAT = 1

/** Most entries one manifest may list. A real pack is a few hundred at most. */
export const MAX_PACK_ENTRIES = 1_000

/** Name of the state file, kept at the root of the Installation rather than inside Mods. */
export const PACK_STATE_FILE_NAME = "sombreterre-pack.json"

export interface ModDbPackEntry {
  source: "moddb"
  modid: string
  version: string
}

export interface PrivatePackEntry {
  source: "private"
  modid: string
  version: string
  /** Archive name, relative to the manifest's own folder. */
  file: string
  /** Lowercase hex SHA-256 of the archive. */
  sha256: string
}

export type PackEntry = ModDbPackEntry | PrivatePackEntry

export interface PackManifest {
  format: typeof PACK_FORMAT
  name: string
  gameVersion: string
  mods: PackEntry[]
}

export type ParsePackManifestFailure = "not-json" | "unsupported-format" | "bad-header" | "bad-entry" | "too-many-entries" | "duplicate-modid"

export type ParsePackManifestResult = { ok: true; manifest: PackManifest } | { ok: false; reason: ParsePackManifestFailure; index?: number }

const MODID_PATTERN = /^[a-z0-9_-]{1,64}$/i
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * Whether `name` can be written into a Mods folder as it stands: one plain `.zip` name, no folder
 * part, no hidden or reserved spelling. ModDB file names are checked with this too, since they reach
 * the disk the same way.
 */
export function isSafePackFileName(name: string): boolean {
  if (name.length < 5 || name.length > 200) return false
  if (!name.toLowerCase().endsWith(".zip")) return false
  if (name.startsWith(".") || name.includes("..")) return false
  // Folder separators, drive colons, the characters Windows refuses in a file name, and control characters.
  if (/[\\/:*?"<>|]/.test(name)) return false
  return ![...name].some((character) => character.charCodeAt(0) < 0x20)
}

function readEntry(value: unknown): PackEntry | undefined {
  if (!isRecord(value)) return undefined
  const { source, modid, version } = value
  if (typeof modid !== "string" || !MODID_PATTERN.test(modid)) return undefined
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) return undefined

  if (source === "moddb") return { source, modid, version }

  if (source === "private") {
    const { file, sha256 } = value
    if (typeof file !== "string" || !isSafePackFileName(file)) return undefined
    if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256.toLowerCase())) return undefined
    return { source, modid, version, file, sha256: sha256.toLowerCase() }
  }

  return undefined
}

/**
 * Reads a manifest, all or nothing. Unlike the game catalog, a pack with one bad row is refused
 * whole: a server that requires a Mod the launcher skipped would only fail later, at connection.
 */
export function parsePackManifest(text: string): ParsePackManifestResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: "not-json" }
  }

  if (!isRecord(raw)) return { ok: false, reason: "bad-header" }
  if (raw["format"] !== PACK_FORMAT) return { ok: false, reason: "unsupported-format" }

  const { name, gameVersion, mods } = raw
  if (typeof name !== "string" || name.length === 0 || name.length > 128) return { ok: false, reason: "bad-header" }
  if (typeof gameVersion !== "string" || !VERSION_PATTERN.test(gameVersion)) return { ok: false, reason: "bad-header" }
  if (!Array.isArray(mods)) return { ok: false, reason: "bad-header" }
  if (mods.length > MAX_PACK_ENTRIES) return { ok: false, reason: "too-many-entries" }

  const entries: PackEntry[] = []
  const seen = new Set<string>()
  for (const [index, value] of mods.entries()) {
    const entry = readEntry(value)
    if (!entry) return { ok: false, reason: "bad-entry", index }
    const key = entry.modid.toLowerCase()
    if (seen.has(key)) return { ok: false, reason: "duplicate-modid", index }
    seen.add(key)
    entries.push(entry)
  }

  return { ok: true, manifest: { format: PACK_FORMAT, name, gameVersion, mods: entries } }
}

/** One archive the Installation should hold, once every entry has been resolved to a download. */
export interface ResolvedPackFile {
  modid: string
  version: string
  source: PackEntry["source"]
  /** Name the archive is saved under in Mods. */
  fileName: string
  url: string
  /** Present for private entries; ModDB publishes no digest. */
  sha256?: string
}

/** One archive the launcher installed, as the state file remembers it. */
export interface PackStateFile {
  modid: string
  version: string
  fileName: string
  sha256?: string
}

export interface PackState {
  format: typeof PACK_FORMAT
  files: PackStateFile[]
}

/** Reads the state file. Anything unreadable counts as "the launcher installed nothing". */
export function parsePackState(text: string | undefined): PackState {
  const empty: PackState = { format: PACK_FORMAT, files: [] }
  if (text === undefined) return empty

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return empty
  }
  if (!isRecord(raw) || raw["format"] !== PACK_FORMAT || !Array.isArray(raw["files"])) return empty

  const files: PackStateFile[] = []
  for (const value of raw["files"]) {
    if (!isRecord(value)) continue
    const { modid, version, fileName, sha256 } = value
    if (typeof modid !== "string" || typeof version !== "string" || typeof fileName !== "string" || !isSafePackFileName(fileName)) continue
    files.push({ modid, version, fileName, ...(typeof sha256 === "string" ? { sha256 } : {}) })
  }
  return { format: PACK_FORMAT, files }
}

export interface PackSyncPlan {
  /** Archives to fetch, in manifest order. */
  download: ResolvedPackFile[]
  /** File names the launcher installed earlier and the pack no longer wants. */
  remove: string[]
  /** File names already in place at the wanted version. */
  keep: string[]
}

/**
 * Decides what a sync does, given what the pack wants, what the launcher installed last time and
 * which file names are actually in Mods right now.
 *
 * A file is kept only when the state file says the launcher put that exact name there for the same
 * Mod at the same version (and digest, when there is one) and the file is still there. Anything else
 * the pack wants is downloaded, overwriting a same-named file. A previously installed name the pack
 * no longer wants is removed, and only if it is still there: a file the player already deleted is
 * not an error.
 */
export function planPackSync(wanted: readonly ResolvedPackFile[], state: PackState, presentFileNames: readonly string[]): PackSyncPlan {
  const present = new Set(presentFileNames.map((name) => name.toLowerCase()))
  const installed = new Map(state.files.map((file) => [file.fileName.toLowerCase(), file]))
  const wantedNames = new Set(wanted.map((file) => file.fileName.toLowerCase()))

  const download: ResolvedPackFile[] = []
  const keep: string[] = []
  for (const file of wanted) {
    const key = file.fileName.toLowerCase()
    const previous = installed.get(key)
    const unchanged = previous !== undefined && previous.modid === file.modid && previous.version === file.version && previous.sha256 === file.sha256
    if (unchanged && present.has(key)) keep.push(file.fileName)
    else download.push(file)
  }

  const remove = state.files.filter((file) => !wantedNames.has(file.fileName.toLowerCase()) && present.has(file.fileName.toLowerCase())).map((file) => file.fileName)

  return { download, remove, keep }
}

/** The state file a finished sync writes: exactly the archives the pack wants. */
export function packStateFor(wanted: readonly ResolvedPackFile[]): PackState {
  return {
    format: PACK_FORMAT,
    files: wanted.map((file) => ({ modid: file.modid, version: file.version, fileName: file.fileName, ...(file.sha256 ? { sha256: file.sha256 } : {}) }))
  }
}

/**
 * The address of a private archive: the manifest's folder plus the file name, and nothing a
 * manifest could use to leave it. Answers undefined when the result would not stay on the
 * manifest's origin.
 */
export function privateFileUrl(manifestUrl: string, file: string): string | undefined {
  if (!isSafePackFileName(file)) return undefined
  try {
    const base = new URL(manifestUrl)
    const url = new URL(encodeURIComponent(file), base)
    return url.origin === base.origin ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** Hosts a ModDB release archive may be fetched from. Anything else in `mainfile` is refused. */
const MODDB_FILE_HOSTS = new Set(["moddbcdn.vintagestory.at", "mods.vintagestory.at"])

/**
 * The download for the ModDB release carrying exactly `version`, read off one `/api/mod/{modid}`
 * detail's `releases`. Answers undefined when no release has that version, or when the one that
 * does carries a file name or address this launcher will not write or fetch.
 */
export function resolveModDbRelease(releases: readonly Record<string, unknown>[], entry: ModDbPackEntry): ResolvedPackFile | undefined {
  const release = releases.find((candidate) => candidate["modversion"] === entry.version)
  if (!release) return undefined

  const { mainfile, filename } = release
  if (typeof mainfile !== "string" || typeof filename !== "string" || !isSafePackFileName(filename)) return undefined

  try {
    const url = new URL(mainfile)
    if (url.protocol !== "https:" || !MODDB_FILE_HOSTS.has(url.hostname.toLowerCase())) return undefined
    return { modid: entry.modid, version: entry.version, source: "moddb", fileName: filename, url: url.toString() }
  } catch {
    return undefined
  }
}
