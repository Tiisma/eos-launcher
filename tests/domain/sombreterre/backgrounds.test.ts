import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { BACKGROUNDS_STATE_FILE_NAME, isBackgroundFileName, parseBackgroundsState, planBackgrounds, readBackgrounds, readLogo } from "@domain/sombreterre/backgrounds"
import { backgroundUrl } from "@src/ipc/sombreterreBackgrounds"

const A = "a".repeat(64)
const B = "b".repeat(64)

describe("readBackgrounds", () => {
  it("keeps pictures with a plain name and a digest, and passes over the rest", () => {
    const list = readBackgrounds([
      { file: "eos-01.png", sha256: A.toUpperCase() },
      { file: "Village au soir.JPG", sha256: B },
      { file: "../escape.png", sha256: A },
      { file: "notes.txt", sha256: A },
      { file: "eos-01.png", sha256: B },
      { file: "nohash.png" }
    ])
    assert.deepEqual(list, [
      { file: "eos-01.png", sha256: A },
      { file: "Village au soir.JPG", sha256: B }
    ])
    assert.deepEqual(readBackgrounds(undefined), [])
  })

  it("refuses names that could leave the folder", () => {
    assert.equal(isBackgroundFileName("a..png"), false)
    assert.equal(isBackgroundFileName("sub/eos.png"), false)
    assert.equal(isBackgroundFileName(".hidden.png"), false)
  })
})

describe("readLogo", () => {
  it("reads the logo's digest, and nothing from an unreadable entry", () => {
    assert.deepEqual(readLogo({ sha256: A.toUpperCase() }), { sha256: A })
    assert.equal(readLogo({ sha256: "nope" }), undefined)
    assert.equal(readLogo(undefined), undefined)
  })
})

describe("planBackgrounds", () => {
  it("fetches new or changed pictures and removes the ones the server dropped", () => {
    const plan = planBackgrounds(
      [
        { file: "kept.png", sha256: A },
        { file: "changed.png", sha256: B },
        { file: "new.jpg", sha256: A }
      ],
      { "kept.png": A, "changed.png": A, "dropped.png": A },
      ["kept.png", "changed.png", "dropped.png", "stray.png", BACKGROUNDS_STATE_FILE_NAME]
    )
    assert.deepEqual(
      plan.download.map((background) => background.file),
      ["changed.png", "new.jpg"]
    )
    assert.deepEqual(plan.remove, ["dropped.png", "stray.png"])
  })

  it("reads a broken state file as empty", () => {
    assert.deepEqual(parseBackgroundsState("{"), {})
    assert.deepEqual(parseBackgroundsState(JSON.stringify({ "ok.png": A, "../x.png": A })), { "ok.png": A })
  })
})

describe("backgroundUrl", () => {
  it("serves beside the manifest, on its origin", () => {
    const manifest = new URL("https://eos-gate.example:8443/api/pack.json")
    assert.equal(backgroundUrl(manifest, "Village au soir.jpg")?.toString(), "https://eos-gate.example:8443/api/backgrounds/Village%20au%20soir.jpg")
  })
})
