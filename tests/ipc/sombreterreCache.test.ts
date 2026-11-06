import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it, vi } from "vitest"

import "./helpers/electronMock"

const state = vi.hoisted(() => ({ installations: [] as { id: string; path: string }[] }))
vi.mock("@src/config/configManager", () => ({ getConfig: vi.fn(async () => ({ installations: state.installations })) }))
vi.mock("@src/ipc/pathPolicy", () => ({ assertConfiguredInstallationPath: vi.fn(async (path: string) => path) }))

import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { clearInstallationPlaying, markInstallationPlaying } from "@src/ipc/installationActivity"
import { GAME_CACHE_FOLDER, clearGameCache } from "@src/ipc/sombreterreCache"

describe("clearGameCache", () => {
  let installation: string
  const cache = (): string => join(installation, GAME_CACHE_FOLDER)

  beforeEach(() => {
    installation = mkdtempSync(join(tmpdir(), "eos-cache-"))
    mkdirSync(join(cache(), "unpack", "somemod"), { recursive: true })
    writeFileSync(join(cache(), "unpack", "somemod", "file.bin"), "x")
    mkdirSync(join(installation, "Saves"))
    writeFileSync(join(installation, "Saves", "world.vcdbs"), "x")
    state.installations = [{ id: SOMBRETERRE_PROFILE.installationId, path: installation }]
  })
  afterEach(() => {
    rmSync(installation, { recursive: true, force: true })
  })

  it("deletes the whole Cache folder and nothing beside it", async () => {
    assert.deepEqual(await clearGameCache(), { ok: true })
    assert.equal(existsSync(cache()), false)
    assert.equal(existsSync(join(installation, "Saves", "world.vcdbs")), true)
  })

  it("answers ok when there is no cache, or no installation yet", async () => {
    rmSync(cache(), { recursive: true })
    assert.deepEqual(await clearGameCache(), { ok: true })
    state.installations = []
    assert.deepEqual(await clearGameCache(), { ok: true })
  })

  it("leaves the cache alone while the game runs", async () => {
    markInstallationPlaying(SOMBRETERRE_PROFILE.installationId)
    try {
      assert.deepEqual(await clearGameCache(), { ok: false, reason: "playing" })
      assert.equal(existsSync(cache()), true)
    } finally {
      clearInstallationPlaying(SOMBRETERRE_PROFILE.installationId)
    }
  })

  it("only ever looks at the server's installation", async () => {
    state.installations = [{ id: "another", path: installation }]
    assert.deepEqual(await clearGameCache(), { ok: true })
    assert.equal(existsSync(cache()), true)
  })
})
