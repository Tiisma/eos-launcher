import { app } from "electron"
import os from "node:os"
import { join } from "node:path"
import fse from "fs-extra"

import { parseCrashFile } from "@domain/gameLogs/crashFile"
import { maskValues, redactSensitiveText } from "@domain/redaction"
import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { getConfig } from "@src/config/configManager"
import { writeJsonAtomic } from "@src/ipc/atomicJsonFile"
import { postGateMetrics } from "@src/ipc/sombreterreGate"
import { isRecord } from "@src/ipc/validation"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreMetrics.ts]"

/** The player's answer, beside the launcher's config. Holds nothing but the answer. */
const CONSENT_FILE_NAME = "sombreterre-metrics.json"
/** Read by the SombreterreGate.Client mod (MetricsClientSystem.ConsentFileName) from the Installation's ModConfig. */
export const GAME_CONSENT_FILE_NAME = "sombreterre-metrics.json"

const CLIENT_CRASH_FILE_NAME = "client-crash.txt"
const CRASH_FILE_BYTES = 256 * 1024
const MAX_TRACE_CHARS = 4000

let cachedConsent: SombreterreMetricsConsent | undefined

function consentPath(): string {
  return join(app.getPath("userData"), CONSENT_FILE_NAME)
}

/**
 * What the player answered to the metrics question. Until they answer, nothing is sent, by the
 * launcher or by the game.
 */
export async function getMetricsConsent(): Promise<SombreterreMetricsConsent> {
  if (cachedConsent !== undefined) return cachedConsent
  try {
    const parsed: unknown = await fse.readJson(consentPath())
    const value = isRecord(parsed) ? parsed["consent"] : undefined
    cachedConsent = value === "yes" || value === "no" ? value : "unanswered"
  } catch {
    cachedConsent = "unanswered"
  }
  return cachedConsent
}

export async function setMetricsConsent(consent: boolean): Promise<void> {
  cachedConsent = consent ? "yes" : "no"
  try {
    await writeJsonAtomic(consentPath(), { consent: cachedConsent })
    logMessage("info", `${LOG_PREFIX} [setMetricsConsent] Anonymous metrics ${consent ? "accepted" : "declined"}.`)
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [setMetricsConsent] Could not store the answer: ${getErrorMessage(error)}`)
  }
}

/** Tells the client mod in this Installation whether it may report the game's performance. */
export async function writeGameConsent(installationPath: string): Promise<void> {
  const consent = (await getMetricsConsent()) === "yes"
  try {
    await fse.ensureDir(join(installationPath, "ModConfig"))
    await writeJsonAtomic(join(installationPath, "ModConfig", GAME_CONSENT_FILE_NAME), { Consent: consent })
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [writeGameConsent] Could not write the game's metrics answer: ${getErrorMessage(error)}`)
  }
}

async function send(report: Record<string, unknown>): Promise<void> {
  if ((await getMetricsConsent()) !== "yes") return
  if (!(await postGateMetrics(report))) logMessage("info", `${LOG_PREFIX} [send] The gate did not take an anonymous ${String(report["kind"])} report.`)
}

/** The graphics card's name, as Chromium sees it. Nothing that identifies the machine itself. */
async function gpuName(): Promise<string | undefined> {
  try {
    const info: unknown = await app.getGPUInfo("complete")
    if (!isRecord(info)) return undefined
    const devices = Array.isArray(info["gpuDevice"]) ? info["gpuDevice"].filter(isRecord) : []
    const active = devices.find((device) => device["active"] === true) ?? devices[0]
    if (active && typeof active["deviceString"] === "string" && active["deviceString"].trim()) return active["deviceString"].trim()
    const aux = isRecord(info["auxAttributes"]) ? info["auxAttributes"] : undefined
    return aux && typeof aux["glRenderer"] === "string" ? aux["glRenderer"] : undefined
  } catch {
    return undefined
  }
}

function osLabel(): string {
  const platform = os.platform()
  const name = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform
  // The major and minor release only: enough to tell systems apart, not one machine from another.
  return `${name} ${os.release().split(".").slice(0, 2).join(".")}`
}

/**
 * One launch through the Play button: the hardware, the versions and how long each step took. Sent
 * only when the player said yes.
 */
export async function reportLaunch(launch: SombreterreLaunchMetrics): Promise<void> {
  if ((await getMetricsConsent()) !== "yes") return
  const cpus = os.cpus()
  const gpu = await gpuName()
  await send({
    kind: "launcher",
    launcherVersion: app.getVersion(),
    gameVersion: SOMBRETERRE_PROFILE.gameVersion,
    ...(launch.optimumVersion ? { optimumVersion: launch.optimumVersion } : {}),
    os: osLabel(),
    ...(cpus[0]?.model ? { cpu: cpus[0].model.trim() } : {}),
    cpuThreads: cpus.length,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    ...(gpu ? { gpu } : {}),
    ...(launch.installSeconds !== undefined ? { installSeconds: launch.installSeconds } : {}),
    ...(launch.syncSeconds !== undefined ? { syncSeconds: launch.syncSeconds } : {}),
    ...(launch.launchError ? { launchError: launch.launchError } : {})
  })
}

/**
 * After the game closed: when it wrote a crash file during this session, reports what failed and where,
 * cleaned of paths, addresses, tokens, the player's account names and their system user name. Sent only
 * when the player said yes.
 */
export async function reportGameCrash(installationPath: string, launchedAtMs: number): Promise<void> {
  if ((await getMetricsConsent()) !== "yes") return
  try {
    const crashPath = join(installationPath, "Logs", CLIENT_CRASH_FILE_NAME)
    const stats = await fse.stat(crashPath).catch(() => null)
    if (!stats || !stats.isFile() || stats.mtimeMs < launchedAtMs) return

    const handle = await fse.open(crashPath, "r")
    let text: string
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, CRASH_FILE_BYTES))
      await fse.read(handle, buffer, 0, buffer.length, 0)
      text = buffer.toString("utf-8")
    } finally {
      await fse.close(handle)
    }

    const crash = parseCrashFile(text)
    if (!crash) return
    const config = await getConfig()
    const known = [...config.accounts.flatMap((account) => [account.email, account.playerName, account.playerUid]), os.userInfo().username, os.hostname()]
    const clean = (value: string): string => maskValues(redactSensitiveText(value), known)
    const trace = clean([crash.exceptionType && `${crash.exceptionType}: ${crash.exceptionMessage ?? ""}`, ...crash.frames].filter(Boolean).join("\n")).slice(0, MAX_TRACE_CHARS)

    await send({
      kind: "crash",
      source: "game",
      version: SOMBRETERRE_PROFILE.gameVersion,
      gameVersion: SOMBRETERRE_PROFILE.gameVersion,
      ...(crash.exceptionType ? { errorType: clean(crash.exceptionType) } : {}),
      ...(crash.blamedModid ? { mod: clean(crash.blamedModid) } : {}),
      ...(trace ? { trace } : {})
    })
  } catch (error) {
    logMessage("info", `${LOG_PREFIX} [reportGameCrash] No crash report sent: ${getErrorMessage(error)}`)
  }
}
