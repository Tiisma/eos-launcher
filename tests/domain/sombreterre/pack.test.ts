import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { isSafePackFileName, packStateFor, parsePackManifest, parsePackState, planPackSync, privateFileUrl, resolveModDbRelease } from "@domain/sombreterre/pack"
import type { PackState, ResolvedPackFile } from "@domain/sombreterre/pack"

const SHA = "ab".repeat(32)

function manifest(mods: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 1, name: "Sombreterre", gameVersion: "1.22.7", mods, ...overrides })
}

function file(overrides: Partial<ResolvedPackFile> = {}): ResolvedPackFile {
  return { modid: "carryon", version: "1.0.0", source: "moddb", fileName: "carryon-1.0.0.zip", url: "https://moddbcdn.vintagestory.at/carryon.zip", ...overrides }
}

describe("parsePackManifest", () => {
  it("reads ModDB and private entries", () => {
    const result = parsePackManifest(
      manifest([
        { source: "moddb", modid: "carryon", version: "1.10.4" },
        { source: "private", modid: "sombreterrecore", version: "0.1.0", file: "sombreterrecore-0.1.0.zip", sha256: SHA.toUpperCase() }
      ])
    )
    assert.ok(result.ok)
    assert.deepEqual(result.manifest.mods, [
      { source: "moddb", modid: "carryon", version: "1.10.4" },
      { source: "private", modid: "sombreterrecore", version: "0.1.0", file: "sombreterrecore-0.1.0.zip", sha256: SHA }
    ])
  })

  it("refuses the whole pack over one bad row", () => {
    const result = parsePackManifest(
      manifest([
        { source: "moddb", modid: "ok", version: "1.0.0" },
        { source: "private", modid: "x", version: "1.0.0", file: "x.zip" }
      ])
    )
    assert.deepEqual(result, { ok: false, reason: "bad-entry", index: 1 })
  })

  it("refuses a private file that leaves the manifest folder", () => {
    for (const name of ["../x.zip", "sub/x.zip", "C:x.zip", ".hidden.zip", "x.dll"]) {
      const result = parsePackManifest(manifest([{ source: "private", modid: "x", version: "1.0.0", file: name, sha256: SHA }]))
      assert.equal(result.ok, false, name)
    }
  })

  it("refuses duplicate modids, unknown formats and non JSON", () => {
    assert.deepEqual(
      parsePackManifest(
        manifest([
          { source: "moddb", modid: "A", version: "1" },
          { source: "moddb", modid: "a", version: "2" }
        ])
      ),
      { ok: false, reason: "duplicate-modid", index: 1 }
    )
    assert.deepEqual(parsePackManifest(manifest([], { format: 2 })), { ok: false, reason: "unsupported-format" })
    assert.deepEqual(parsePackManifest("{"), { ok: false, reason: "not-json" })
  })
})

describe("planPackSync", () => {
  const state: PackState = {
    format: 1,
    files: [
      { modid: "carryon", version: "1.0.0", fileName: "carryon-1.0.0.zip" },
      { modid: "old", version: "1.0.0", fileName: "old-1.0.0.zip" }
    ]
  }

  it("keeps what is in place, removes what the pack dropped", () => {
    const plan = planPackSync([file()], state, ["carryon-1.0.0.zip", "old-1.0.0.zip", "player-mod.zip"])
    assert.deepEqual(plan, { download: [], remove: ["old-1.0.0.zip"], keep: ["carryon-1.0.0.zip"] })
  })

  it("downloads again a file the player deleted or that changed version", () => {
    assert.deepEqual(planPackSync([file()], state, []).download, [file()])
    assert.deepEqual(planPackSync([file({ version: "1.0.1" })], state, ["carryon-1.0.0.zip"]).download, [file({ version: "1.0.1" })])
  })

  it("never removes a file it did not install", () => {
    const plan = planPackSync([], { format: 1, files: [] }, ["player-mod.zip"])
    assert.deepEqual(plan.remove, [])
  })

  it("writes back exactly what the pack wants", () => {
    const wanted = [file(), file({ modid: "core", source: "private", fileName: "core.zip", sha256: SHA })]
    assert.deepEqual(parsePackState(JSON.stringify(packStateFor(wanted))).files, [
      { modid: "carryon", version: "1.0.0", fileName: "carryon-1.0.0.zip" },
      { modid: "core", version: "1.0.0", fileName: "core.zip", sha256: SHA }
    ])
  })

  it("treats an unreadable state file as empty", () => {
    assert.deepEqual(parsePackState("nope"), { format: 1, files: [] })
    assert.deepEqual(parsePackState(undefined), { format: 1, files: [] })
  })
})

describe("addresses", () => {
  it("resolves private files beside the manifest only", () => {
    assert.equal(privateFileUrl("http://127.0.0.1:8787/pack/pack.json", "core 1.zip"), "http://127.0.0.1:8787/pack/core%201.zip")
    assert.equal(privateFileUrl("http://127.0.0.1:8787/pack.json", "../core.zip"), undefined)
  })

  it("picks the ModDB release by exact version and refuses foreign hosts", () => {
    const releases = [
      { modversion: "1.0.1", mainfile: "https://moddbcdn.vintagestory.at/a.zip", filename: "a-1.0.1.zip" },
      { modversion: "1.0.0", mainfile: "https://evil.example/a.zip", filename: "a-1.0.0.zip" }
    ]
    assert.equal(resolveModDbRelease(releases, { source: "moddb", modid: "a", version: "1.0.1" })?.fileName, "a-1.0.1.zip")
    assert.equal(resolveModDbRelease(releases, { source: "moddb", modid: "a", version: "1.0.0" }), undefined)
    assert.equal(resolveModDbRelease(releases, { source: "moddb", modid: "a", version: "2.0.0" }), undefined)
  })

  it("carries a pinned ModDB hash through to the download, and refuses a malformed one", () => {
    const pinned = parsePackManifest(manifest([{ source: "moddb", modid: "a", version: "1.0.1", sha256: SHA.toUpperCase() }]))
    assert.ok(pinned.ok)
    const entry = pinned.manifest.mods[0]
    assert.ok(entry?.source === "moddb")
    const releases = [{ modversion: "1.0.1", mainfile: "https://moddbcdn.vintagestory.at/a.zip", filename: "a-1.0.1.zip" }]
    assert.equal(resolveModDbRelease(releases, entry)?.sha256, SHA)
    assert.equal(parsePackManifest(manifest([{ source: "moddb", modid: "a", version: "1.0.1", sha256: "xyz" }])).ok, false)
  })

  it("accepts plain zip names only", () => {
    assert.equal(isSafePackFileName("carryon_1.10.4.zip"), true)
    assert.equal(isSafePackFileName("a|b.zip"), false)
  })
})
