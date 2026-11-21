/**
 * The main menu backgrounds a server offers (the gate's SombreterreBackgrounds folder), listed in the
 * pack manifest under `backgrounds`, and the plan that keeps one Installation's copy in line with them.
 *
 * The folder is the launcher's own: what it holds and nothing else is the server's current list, so a
 * picture removed on the server is removed here too.
 */

import { isRecord } from "../records"

/** The Installation's folder, read by the client mod (and its startup hook) for the main menu. */
export const BACKGROUNDS_FOLDER_NAME = "EoSBackgrounds"

/** The Installation's copy of the server's title logo, read by the client mod for the main menu. */
export const LOGO_FILE_NAME = "EoSLogo.png"

/** What the launcher remembers of the folder, so an unchanged picture is neither hashed nor fetched again. */
export const BACKGROUNDS_STATE_FILE_NAME = ".eos-backgrounds.json"

export const MAX_BACKGROUNDS = 100
export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024

export interface PackBackground {
  file: string
  /** Lowercase hex SHA-256. */
  sha256: string
}

const BACKGROUND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,99}\.(png|jpe?g)$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** True for a picture name the launcher may write into the folder: what the gate itself accepts. */
export function isBackgroundFileName(name: string): boolean {
  return BACKGROUND_NAME_PATTERN.test(name) && !name.includes("..")
}

/** The manifest's `logo`: its digest, or undefined when the server has none (or an unreadable one). */
export function readLogo(value: unknown): { sha256: string } | undefined {
  if (!isRecord(value) || typeof value["sha256"] !== "string") return undefined
  const digest = value["sha256"].toLowerCase()
  return SHA256_PATTERN.test(digest) ? { sha256: digest } : undefined
}

/** The manifest's `backgrounds`. Unreadable rows are passed over: a picture is never worth refusing the pack. */
export function readBackgrounds(value: unknown): PackBackground[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const list: PackBackground[] = []
  for (const row of value) {
    if (list.length >= MAX_BACKGROUNDS) break
    if (!isRecord(row)) continue
    const { file, sha256 } = row
    if (typeof file !== "string" || !isBackgroundFileName(file) || typeof sha256 !== "string") continue
    const digest = sha256.toLowerCase()
    if (!SHA256_PATTERN.test(digest) || seen.has(file.toLowerCase())) continue
    seen.add(file.toLowerCase())
    list.push({ file, sha256: digest })
  }
  return list
}

/** The state file, or an empty one. */
export function parseBackgroundsState(text: string | undefined): Record<string, string> {
  try {
    const raw: unknown = text === undefined ? {} : JSON.parse(text)
    if (!isRecord(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => isBackgroundFileName(entry[0]) && typeof entry[1] === "string"))
  } catch {
    return {}
  }
}

export interface BackgroundsPlan {
  download: PackBackground[]
  /** Names in the folder the server no longer lists, the state file aside. */
  remove: string[]
}

/** What to fetch and what to delete so the folder holds exactly `wanted`. */
export function planBackgrounds(wanted: readonly PackBackground[], state: Record<string, string>, presentNames: readonly string[]): BackgroundsPlan {
  const present = new Set(presentNames)
  const wantedNames = new Set(wanted.map((background) => background.file))
  return {
    download: wanted.filter((background) => !present.has(background.file) || state[background.file] !== background.sha256),
    remove: presentNames.filter((name) => name !== BACKGROUNDS_STATE_FILE_NAME && !wantedNames.has(name))
  }
}
