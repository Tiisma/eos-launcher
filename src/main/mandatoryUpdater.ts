import type { AppUpdater } from "electron-updater"

import {
  DOWNLOAD_RETRY_DELAYS_MS,
  INITIAL_CHECK_TIMEOUT_MS,
  INSTALL_COUNTDOWN_SECONDS,
  isMandatoryUpdate,
  PERIODIC_CHECK_INTERVAL_MS,
  type LauncherUpdateState
} from "@src/domain/appUpdate/mandatoryUpdate"

const LOG_PREFIX = "[back] [mandatoryUpdater] [main/mandatoryUpdater.ts]"

/** How often a downloaded update looks again at whether the game (or another close-blocking task) has finished. */
const BUSY_POLL_MS = 2_000

/** The few things the controller needs from electron-updater, so it can be driven from a test. */
export interface UpdaterPort {
  /** Resolves null when the updater is inactive (an unpackaged run). */
  checkForUpdates: () => Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void
  onDownloadProgress: (callback: (percent: number) => void) => void
}

export interface MandatoryUpdaterDeps {
  updater: UpdaterPort
  /** `app.getVersion()`. */
  runningVersion: string
  /** True while the game, or anything else that holds the window open, is running. Never interrupted. */
  isBusy: () => boolean
  publish: (state: LauncherUpdateState) => void
  log: (level: ErrorTypes, message: string) => void
}

/** The first line of an error's message: with the GitHub provider, what follows is the whole releases feed (#650). */
function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split(/\r?\n/, 1)[0] ?? ""
}

/** Percent as a whole number between 0 and 100. */
export function toPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * Keeps the launcher on the newest stable release of this fork, without asking.
 *
 * - Checks at start and every {@link PERIODIC_CHECK_INTERVAL_MS} after that.
 * - A newer stable release is downloaded straight away, retried after each wait of
 *   {@link DOWNLOAD_RETRY_DELAYS_MS}, then reported as `download-failed` (the player can retry, or
 *   download it by hand; the next periodic check also tries again).
 * - Once downloaded, it waits for `isBusy` to clear (the game is never interrupted), counts down
 *   {@link INSTALL_COUNTDOWN_SECONDS} on screen and runs the installer silently, which starts the
 *   launcher again.
 * - A check that fails is logged and lets play through: an unreachable GitHub must not lock anyone
 *   out of the server. The first check is also bounded by {@link INITIAL_CHECK_TIMEOUT_MS}.
 */
export class MandatoryUpdater {
  private state: LauncherUpdateState = { status: "disabled" }
  private checkInFlight = false
  private initialTimer: ReturnType<typeof setTimeout> | undefined
  private periodicTimer: ReturnType<typeof setInterval> | undefined
  private installTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly deps: MandatoryUpdaterDeps) {
    deps.updater.onDownloadProgress((percent) => {
      if (this.state.status !== "downloading") return
      const progress = toPercent(percent)
      if (progress !== this.state.progress) this.set({ ...this.state, progress })
    })
  }

  getState(): LauncherUpdateState {
    return this.state
  }

  /** Runs the first check now and arms the periodic one. */
  start(): void {
    this.set({ status: "checking" })
    void this.check()
    this.periodicTimer = setInterval(() => void this.check(), PERIODIC_CHECK_INTERVAL_MS)
    this.periodicTimer.unref?.()
  }

  stop(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer)
    if (this.initialTimer) clearTimeout(this.initialTimer)
    this.clearInstallTimer()
  }

  /** One check. Does nothing while an update is already being downloaded or installed. */
  async check(): Promise<void> {
    const { status } = this.state
    if (this.checkInFlight || status === "downloading" || status === "waiting-for-game" || status === "installing") return
    this.checkInFlight = true

    if (status === "checking") {
      this.initialTimer = setTimeout(() => {
        if (this.state.status !== "checking") return
        this.deps.log("warn", `${LOG_PREFIX} [check] The update check is taking too long. Letting play through.`)
        this.set({ status: "check-failed" })
      }, INITIAL_CHECK_TIMEOUT_MS)
      this.initialTimer.unref?.()
    }

    let found: string | undefined
    try {
      const result = await this.deps.updater.checkForUpdates()
      const version = result?.updateInfo?.version
      if (result?.isUpdateAvailable === true && isMandatoryUpdate(version, this.deps.runningVersion)) found = version
      else {
        this.deps.log("info", `${LOG_PREFIX} [check] No newer launcher release than ${this.deps.runningVersion}.`)
        // A "Retry" may have started a download while this check was out: that one wins.
        if (this.currentStatus() !== "downloading") this.set({ status: "up-to-date" })
      }
    } catch (error) {
      // Offline, GitHub down, or no published release carrying update metadata yet: fail open.
      this.deps.log("warn", `${LOG_PREFIX} [check] Update check failed: ${firstLine(error)}.`)
      if (this.state.status === "checking") this.set({ status: "check-failed" })
    } finally {
      if (this.initialTimer) clearTimeout(this.initialTimer)
      this.initialTimer = undefined
      this.checkInFlight = false
    }

    if (found !== undefined) {
      this.deps.log("info", `${LOG_PREFIX} [check] Launcher ${found} is available. Downloading it (mandatory update).`)
      await this.download(found)
    }
  }

  /** The player's "try again" after `download-failed`. */
  retryDownload(): void {
    if (this.state.status !== "download-failed") return
    void this.download(this.state.version)
  }

  /** The player's "restart now" during the countdown. */
  installNow(): void {
    if (this.state.status !== "installing") return
    this.install(this.state.version)
  }

  private async download(version: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      this.set({ status: "downloading", version, progress: 0 })
      try {
        await this.deps.updater.downloadUpdate()
        break
      } catch (error) {
        const delay = DOWNLOAD_RETRY_DELAYS_MS[attempt]
        this.deps.log("warn", `${LOG_PREFIX} [download] Download of launcher ${version} failed (attempt ${attempt + 1}): ${firstLine(error)}.`)
        if (delay === undefined) {
          this.deps.log("error", `${LOG_PREFIX} [download] Giving up on launcher ${version} for now. The player can retry or download it by hand.`)
          this.set({ status: "download-failed", version })
          return
        }
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
      }
    }

    this.deps.log("info", `${LOG_PREFIX} [download] Launcher ${version} downloaded.`)
    this.whenIdle(version)
  }

  /** Waits for the game (and every other close-blocking task) to finish, then starts the countdown. */
  private whenIdle(version: string): void {
    this.clearInstallTimer()
    if (!this.deps.isBusy()) return this.countdown(version)

    this.deps.log("info", `${LOG_PREFIX} [whenIdle] Launcher ${version} will be installed once the game is closed.`)
    this.set({ status: "waiting-for-game", version })
    this.installTimer = setInterval(() => {
      if (this.deps.isBusy()) return
      this.countdown(version)
    }, BUSY_POLL_MS)
  }

  private countdown(version: string): void {
    this.clearInstallTimer()
    let secondsLeft = INSTALL_COUNTDOWN_SECONDS
    this.set({ status: "installing", version, secondsLeft })
    this.installTimer = setInterval(() => {
      // Something started in the meantime (a game, a backup): wait for it again.
      if (this.deps.isBusy()) return this.whenIdle(version)
      secondsLeft -= 1
      if (secondsLeft <= 0) return this.install(version)
      this.set({ status: "installing", version, secondsLeft })
    }, 1_000)
  }

  private install(version: string): void {
    this.clearInstallTimer()
    if (this.deps.isBusy()) return this.whenIdle(version)

    this.set({ status: "installing", version, secondsLeft: 0 })
    this.deps.log("info", `${LOG_PREFIX} [install] Installing launcher ${version} and restarting.`)
    // Silent and run-after, both on purpose (#668): not silent, the assisted NSIS installer opens its
    // wizard while the launcher is already gone; silent, it updates the existing install in place and
    // starts the launcher again.
    this.deps.updater.quitAndInstall(true, true)
  }

  /** Read through a call so a check of the state after an await is not narrowed by one before it. */
  private currentStatus(): LauncherUpdateState["status"] {
    return this.state.status
  }

  private clearInstallTimer(): void {
    if (this.installTimer) clearInterval(this.installTimer)
    this.installTimer = undefined
  }

  private set(state: LauncherUpdateState): void {
    this.state = state
    this.deps.publish(state)
  }
}

/**
 * Runs the check with electron-updater's own record of its failure switched off.
 *
 * The package reports a failed check by itself, before the promise rejects: its constructor listens
 * to its own "error" event and writes `Error: ${error.stack}` through its logger, at error level.
 * With the GitHub provider that message is a first line naming the reason followed by the whole
 * releases feed, so a check that failed put a page of XML in error.log (#650). MandatoryUpdater
 * reports the same failure once, in one line, which makes the package's line the duplicate.
 *
 * Only the error level of the logger in place is swapped out, and it goes back whatever the check
 * does. A download or an install that fails has no check around it, so the package's record of those
 * stays as it was. tests/main/updateCheckFailureLog.test.ts holds that against the real package.
 */
async function checkWithoutErrorRecord(autoUpdater: AppUpdater): ReturnType<UpdaterPort["checkForUpdates"]> {
  const logger = autoUpdater.logger
  autoUpdater.logger = {
    info: (message?: unknown): void => logger?.info(message),
    warn: (message?: unknown): void => logger?.warn(message),
    error: (): void => {},
    debug: (message: string): void => logger?.debug?.(message)
  }

  try {
    return await autoUpdater.checkForUpdates()
  } finally {
    autoUpdater.logger = logger
  }
}

/**
 * Sets electron-updater up for a mandatory, stable-only update and wraps it for {@link MandatoryUpdater}.
 *
 * - autoDownload off: the controller starts the download itself, so it can retry and report it.
 * - autoInstallOnAppQuit on: a player who closes the launcher during the wait still gets the update.
 * - allowPrerelease off: the stock GitHub provider then asks GitHub for its "latest release", which is
 *   never a draft or a prerelease.
 * - allowDowngrade off: an older release is never installed.
 * - disableWebInstaller on: the NSIS target here is a full installer.
 *
 * The installer is not code-signed. electron-updater (6.8.9, NsisUpdater.verifySignature) only checks
 * a signature when app-update.yml carries a `publisherName`, which electron-builder writes only for a
 * signed build, so the unsigned update is accepted. Its SHA-512 from latest.yml is still checked.
 */
export function electronUpdaterPort(autoUpdater: AppUpdater): UpdaterPort {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.disableWebInstaller = true

  return {
    checkForUpdates: () => checkWithoutErrorRecord(autoUpdater),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: (isSilent, isForceRunAfter) => autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
    onDownloadProgress: (callback) => {
      autoUpdater.on("download-progress", (progress) => callback(progress?.percent ?? 0))
    }
  }
}
