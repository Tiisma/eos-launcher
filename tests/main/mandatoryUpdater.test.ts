import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, vi } from "vitest"

import { DOWNLOAD_RETRY_DELAYS_MS, INITIAL_CHECK_TIMEOUT_MS, INSTALL_COUNTDOWN_SECONDS, PERIODIC_CHECK_INTERVAL_MS, type LauncherUpdateState } from "@src/domain/appUpdate/mandatoryUpdate"
import { MandatoryUpdater, type UpdaterPort } from "@src/main/mandatoryUpdater"

/**
 * The mandatory update's decisions, against a double of electron-updater. What the real package
 * logs when a check fails is tests/main/updateCheckFailureLog.test.ts's job.
 */

type CheckResult = Awaited<ReturnType<UpdaterPort["checkForUpdates"]>>

interface Harness {
  controller: MandatoryUpdater
  states: LauncherUpdateState[]
  logs: Array<{ level: ErrorTypes; message: string }>
  updater: {
    checkForUpdates: ReturnType<typeof vi.fn<() => Promise<CheckResult>>>
    downloadUpdate: ReturnType<typeof vi.fn<() => Promise<unknown>>>
    quitAndInstall: ReturnType<typeof vi.fn<(isSilent: boolean, isForceRunAfter: boolean) => void>>
    progress: (percent: number) => void
  }
  busy: { value: boolean }
}

const NEWER: CheckResult = { isUpdateAvailable: true, updateInfo: { version: "0.1.2" } }
const NOTHING: CheckResult = { isUpdateAvailable: false, updateInfo: { version: "0.1.1" } }

function harness(check: () => Promise<CheckResult>, download: () => Promise<unknown> = async () => []): Harness {
  const states: LauncherUpdateState[] = []
  const logs: Harness["logs"] = []
  const busy = { value: false }
  let progress: (percent: number) => void = () => {}
  const updater = {
    checkForUpdates: vi.fn(check),
    downloadUpdate: vi.fn(download),
    quitAndInstall: vi.fn<(isSilent: boolean, isForceRunAfter: boolean) => void>(),
    progress: (percent: number): void => progress(percent)
  }
  const controller = new MandatoryUpdater({
    updater: {
      checkForUpdates: updater.checkForUpdates,
      downloadUpdate: updater.downloadUpdate,
      quitAndInstall: updater.quitAndInstall,
      onDownloadProgress: (callback): void => {
        progress = callback
      }
    },
    runningVersion: "0.1.1",
    isBusy: (): boolean => busy.value,
    publish: (state): void => {
      states.push(state)
    },
    log: (level, message): void => {
      logs.push({ level, message })
    }
  })
  return { controller, states, logs, updater, busy }
}

const last = (h: Harness): LauncherUpdateState | undefined => h.states.at(-1)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the mandatory launcher update", () => {
  it("lets play through once a check finds nothing newer", async () => {
    const h = harness(async () => NOTHING)
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    assert.deepEqual(h.states, [{ status: "checking" }, { status: "up-to-date" }])
    assert.equal(h.updater.downloadUpdate.mock.calls.length, 0)
    h.controller.stop()
  })

  it("fails open and logs it when GitHub cannot be reached", async () => {
    const h = harness(async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED\n<feed>…</feed>")
    })
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    assert.deepEqual(last(h), { status: "check-failed" })
    assert.deepEqual(
      h.logs.filter((line) => line.level === "warn").map((line) => line.message),
      ["[back] [mandatoryUpdater] [main/mandatoryUpdater.ts] [check] Update check failed: net::ERR_INTERNET_DISCONNECTED."]
    )
    h.controller.stop()
  })

  it("lets play through when the first check hangs past its time limit", async () => {
    const h = harness(() => new Promise<CheckResult>(() => {}))
    h.controller.start()
    await vi.advanceTimersByTimeAsync(INITIAL_CHECK_TIMEOUT_MS - 1)
    assert.deepEqual(last(h), { status: "checking" })

    await vi.advanceTimersByTimeAsync(1)
    assert.deepEqual(last(h), { status: "check-failed" })
    h.controller.stop()
  })

  it("downloads a newer stable release without asking, then counts down and installs silently", async () => {
    const h = harness(async () => NEWER)
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    assert.deepEqual(h.states.slice(0, 2), [{ status: "checking" }, { status: "downloading", version: "0.1.2", progress: 0 }])
    assert.equal(h.updater.downloadUpdate.mock.calls.length, 1)
    assert.deepEqual(last(h), { status: "installing", version: "0.1.2", secondsLeft: INSTALL_COUNTDOWN_SECONDS })

    await vi.advanceTimersByTimeAsync((INSTALL_COUNTDOWN_SECONDS - 1) * 1_000)
    assert.equal(h.updater.quitAndInstall.mock.calls.length, 0)

    await vi.advanceTimersByTimeAsync(1_000)
    assert.deepEqual(h.updater.quitAndInstall.mock.calls, [[true, true]])
    h.controller.stop()
  })

  it("reports download progress as whole percentages", async () => {
    let finish: () => void = () => {}
    const h = harness(
      async () => NEWER,
      () =>
        new Promise((resolve) => {
          finish = (): void => resolve([])
        })
    )
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    h.updater.progress(41.6)
    assert.deepEqual(last(h), { status: "downloading", version: "0.1.2", progress: 42 })
    finish()
    h.controller.stop()
  })

  it("ignores an offered prerelease, whatever electron-updater says", async () => {
    const h = harness(async () => ({ isUpdateAvailable: true, updateInfo: { version: "0.2.0-beta.1" } }))
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    assert.deepEqual(last(h), { status: "up-to-date" })
    assert.equal(h.updater.downloadUpdate.mock.calls.length, 0)
    h.controller.stop()
  })

  it("retries a failed download, then keeps play blocked with a way out", async () => {
    const h = harness(
      async () => NEWER,
      async () => {
        throw new Error("connection reset")
      }
    )
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)
    for (const delay of DOWNLOAD_RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay)

    assert.equal(h.updater.downloadUpdate.mock.calls.length, DOWNLOAD_RETRY_DELAYS_MS.length + 1)
    assert.deepEqual(last(h), { status: "download-failed", version: "0.1.2" })
    assert.ok(h.logs.some((line) => line.level === "error"))

    // The player's "Retry" starts a new attempt.
    h.updater.downloadUpdate.mockImplementation(async () => [])
    h.controller.retryDownload()
    await vi.advanceTimersByTimeAsync(0)
    assert.deepEqual(last(h), { status: "installing", version: "0.1.2", secondsLeft: INSTALL_COUNTDOWN_SECONDS })
    h.controller.stop()
  })

  it("never interrupts a running game: it waits for it to close", async () => {
    const h = harness(async () => NEWER)
    h.busy.value = true
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    assert.deepEqual(last(h), { status: "waiting-for-game", version: "0.1.2" })
    await vi.advanceTimersByTimeAsync(60_000)
    assert.equal(h.updater.quitAndInstall.mock.calls.length, 0)

    h.busy.value = false
    await vi.advanceTimersByTimeAsync(2_000)
    assert.deepEqual(last(h), { status: "installing", version: "0.1.2", secondsLeft: INSTALL_COUNTDOWN_SECONDS })
    await vi.advanceTimersByTimeAsync(INSTALL_COUNTDOWN_SECONDS * 1_000)
    assert.deepEqual(h.updater.quitAndInstall.mock.calls, [[true, true]])
    h.controller.stop()
  })

  it("goes back to waiting when the game starts during the countdown", async () => {
    const h = harness(async () => NEWER)
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    h.busy.value = true
    await vi.advanceTimersByTimeAsync(1_000)
    assert.deepEqual(last(h), { status: "waiting-for-game", version: "0.1.2" })
    assert.equal(h.updater.quitAndInstall.mock.calls.length, 0)
    h.controller.stop()
  })

  it("restarts at once when the player asks during the countdown", async () => {
    const h = harness(async () => NEWER)
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)

    h.controller.installNow()
    assert.deepEqual(h.updater.quitAndInstall.mock.calls, [[true, true]])
    h.controller.stop()
  })

  it("checks again periodically, and finds a release published while the launcher was open", async () => {
    const h = harness(async () => NOTHING)
    h.controller.start()
    await vi.advanceTimersByTimeAsync(0)
    assert.deepEqual(last(h), { status: "up-to-date" })

    h.updater.checkForUpdates.mockImplementation(async () => NEWER)
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS)
    assert.equal(h.updater.checkForUpdates.mock.calls.length, 2)
    assert.equal(h.updater.downloadUpdate.mock.calls.length, 1)
    h.controller.stop()
  })

  it("does not check again while an update is already under way", async () => {
    const h = harness(
      async () => NEWER,
      () => new Promise(() => {})
    )
    h.controller.start()
    await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS * 2)

    assert.equal(h.updater.checkForUpdates.mock.calls.length, 1)
    assert.equal(h.updater.downloadUpdate.mock.calls.length, 1)
    h.controller.stop()
  })
})
