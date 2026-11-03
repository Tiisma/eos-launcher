import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { isMandatoryUpdate, LAUNCHER_RELEASES_URL, updateBlocksPlay, type LauncherUpdateState } from "@domain/appUpdate/mandatoryUpdate"
import { assertAllowedBrowserUrl } from "@src/ipc/validation"

describe("isMandatoryUpdate", () => {
  it("forces a strictly newer stable release", () => {
    assert.equal(isMandatoryUpdate("0.1.2", "0.1.1"), true)
    assert.equal(isMandatoryUpdate("1.0.0", "0.9.9"), true)
  })

  it("compares by semver, not as text", () => {
    assert.equal(isMandatoryUpdate("0.1.10", "0.1.9"), true)
    assert.equal(isMandatoryUpdate("0.1.9", "0.1.10"), false)
  })

  it("never forces the same version or an older one", () => {
    assert.equal(isMandatoryUpdate("0.1.1", "0.1.1"), false)
    assert.equal(isMandatoryUpdate("0.1.0", "0.1.1"), false)
  })

  it("never forces a prerelease, even on a prerelease build", () => {
    assert.equal(isMandatoryUpdate("0.2.0-beta.1", "0.1.1"), false)
    assert.equal(isMandatoryUpdate("0.2.0-rc.1", "0.2.0-beta.1"), false)
  })

  it("moves a prerelease build onto its stable release", () => {
    assert.equal(isMandatoryUpdate("0.2.0", "0.2.0-beta.1"), true)
  })

  it("treats anything that is not a version as no update", () => {
    assert.equal(isMandatoryUpdate(undefined, "0.1.1"), false)
    assert.equal(isMandatoryUpdate("latest", "0.1.1"), false)
    assert.equal(isMandatoryUpdate("0.1.2", "not-a-version"), false)
  })
})

describe("updateBlocksPlay", () => {
  const blocking: LauncherUpdateState[] = [
    { status: "checking" },
    { status: "downloading", version: "0.1.2", progress: 40 },
    { status: "download-failed", version: "0.1.2" },
    { status: "waiting-for-game", version: "0.1.2" },
    { status: "installing", version: "0.1.2", secondsLeft: 5 }
  ]
  const open: LauncherUpdateState[] = [{ status: "disabled" }, { status: "up-to-date" }, { status: "check-failed" }]

  it("blocks play while a newer launcher is known to exist, and during the first check", () => {
    for (const state of blocking) assert.equal(updateBlocksPlay(state), true, state.status)
  })

  it("fails open when there is no updater, nothing newer, or GitHub could not be reached", () => {
    for (const state of open) assert.equal(updateBlocksPlay(state), false, state.status)
  })

  it("waits for the main process's first answer", () => {
    assert.equal(updateBlocksPlay(undefined), true)
  })
})

describe("the manual download link", () => {
  it("is a page the launcher is allowed to open in the browser", () => {
    assert.doesNotThrow(() => assertAllowedBrowserUrl(LAUNCHER_RELEASES_URL))
  })
})
