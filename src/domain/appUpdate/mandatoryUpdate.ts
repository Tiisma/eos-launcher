import semver from "semver"

/**
 * The launcher's own update, made mandatory for this fork.
 *
 * Every player has to run the newest stable launcher: the server's gate and pack evolve with it,
 * and an outdated launcher is the one thing a player cannot be expected to notice by themselves.
 * The main process (src/main/mandatoryUpdater.ts) checks this fork's GitHub releases, downloads a
 * newer stable build on its own and installs it; the home screen reads the state below and keeps
 * Play disabled while it is under way.
 *
 * One rule is held the other way: a check that cannot reach GitHub (offline, GitHub down, no
 * release carrying update metadata yet) never blocks play. Only an update that is known to exist
 * does.
 */

/** Where a player can download the launcher by hand when the automatic download keeps failing. */
export const LAUNCHER_RELEASES_URL = "https://github.com/Tiisma/eos-launcher/releases/latest"

/** How long the first check of a launch may take before Play is let through anyway. */
export const INITIAL_CHECK_TIMEOUT_MS = 20_000

/** How often a running launcher checks again, so one left open for a whole evening still updates. */
export const PERIODIC_CHECK_INTERVAL_MS = 30 * 60 * 1000

/** The waits before each new attempt at a failed download. Their count is the number of retries. */
export const DOWNLOAD_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000]

/** How long the "restarting" countdown stays on screen before the installer runs. */
export const INSTALL_COUNTDOWN_SECONDS = 10

/**
 * What the home screen is told about the launcher's own update.
 *
 * - `disabled`: no updater in this build (a dev run, an unsupported package, UPDATE=false).
 * - `checking`: the first check of this launch is in flight.
 * - `up-to-date`: the last check found nothing newer.
 * - `check-failed`: the check could not reach the releases; play stays open (fail open).
 * - `downloading`: a newer stable build was found and is being fetched.
 * - `download-failed`: every attempt failed; the player can retry or download it by hand.
 * - `waiting-for-game`: downloaded, held back because the game (or another task) is still running.
 * - `installing`: downloaded, the launcher restarts into it once the countdown reaches zero.
 */
export type LauncherUpdateState =
  | { status: "disabled" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "check-failed" }
  | { status: "downloading"; version: string; progress: number }
  | { status: "download-failed"; version: string }
  | { status: "waiting-for-game"; version: string }
  | { status: "installing"; version: string; secondsLeft: number }

/**
 * Whether `offered` must replace `running`.
 *
 * Strictly newer by semver, and a stable release only: a prerelease is never forced on anyone,
 * even when the running build is one. Anything that is not a valid version on either side is not
 * an update, so a malformed feed can never lock a player out.
 */
export function isMandatoryUpdate(offered: string | undefined, running: string): boolean {
  const offeredVersion = semver.valid(offered ?? "")
  const runningVersion = semver.valid(running)
  if (!offeredVersion || !runningVersion) return false
  if (semver.prerelease(offeredVersion) !== null) return false
  return semver.gt(offeredVersion, runningVersion)
}

/**
 * Whether Play has to wait for the launcher's update.
 *
 * Only states where a newer launcher is known to exist, plus the short first check, block. The
 * first check is bounded by {@link INITIAL_CHECK_TIMEOUT_MS} in the main process, after which it
 * becomes `check-failed` and Play is let through. `undefined` is the renderer's own moment before
 * the main process has answered at all, a local round trip, and waits like `checking` does.
 */
export function updateBlocksPlay(state: LauncherUpdateState | undefined): boolean {
  if (state === undefined) return true
  switch (state.status) {
    case "checking":
    case "downloading":
    case "download-failed":
    case "waiting-for-game":
    case "installing":
      return true
    case "disabled":
    case "up-to-date":
    case "check-failed":
      return false
  }
}
