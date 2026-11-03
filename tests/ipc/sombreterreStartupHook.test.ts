import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32 } from "node:zlib"
import { afterEach, beforeEach, describe, it } from "vitest"

import "./helpers/electronMock"
import { STARTUP_HOOK_FILE, STARTUP_HOOK_FOLDER, installStartupHook, startupHookEnvironment } from "@src/ipc/sombreterreStartupHook"

/** A STORE-only zip of the given entries, enough for yauzl. */
function zipOf(entries: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, "utf-8")
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    const localPart = Buffer.concat([local, nameBuf, data])
    locals.push(localPart)
    centrals.push(Buffer.concat([central, nameBuf]))
    offset += localPart.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}

describe("sombreterre startup hook", () => {
  let installation: string
  const hookPath = (): string => join(installation, STARTUP_HOOK_FOLDER, STARTUP_HOOK_FILE)
  const seedMod = (name: string, entries: Record<string, Buffer>): void => {
    mkdirSync(join(installation, "Mods"), { recursive: true })
    writeFileSync(join(installation, "Mods", name), zipOf(entries))
  }

  beforeEach(() => {
    installation = mkdtempSync(join(tmpdir(), "eos-hook-"))
  })
  afterEach(() => {
    rmSync(installation, { recursive: true, force: true })
  })

  it("copies the hook out of the client mod and hands it to the game", async () => {
    seedMod("sombreterregate_0.3.0.zip", { "modinfo.json": Buffer.from("{}"), [`native/${STARTUP_HOOK_FILE}`]: Buffer.from("hook v1") })
    await installStartupHook(installation)
    assert.equal(readFileSync(hookPath(), "utf-8"), "hook v1")
    assert.deepEqual(await startupHookEnvironment(installation), { DOTNET_STARTUP_HOOKS: hookPath() })
  })

  it("replaces the hook when the client mod changes", async () => {
    seedMod("sombreterregate_0.3.0.zip", { [`native/${STARTUP_HOOK_FILE}`]: Buffer.from("hook v1") })
    await installStartupHook(installation)
    rmSync(join(installation, "Mods", "sombreterregate_0.3.0.zip"))
    seedMod("sombreterregate_0.3.1.zip", { [`native/${STARTUP_HOOK_FILE}`]: Buffer.from("hook v2") })
    await installStartupHook(installation)
    assert.equal(readFileSync(hookPath(), "utf-8"), "hook v2")
  })

  it("removes the hook when the client mod has none, and the game then starts without one", async () => {
    seedMod("sombreterregate_0.3.0.zip", { [`native/${STARTUP_HOOK_FILE}`]: Buffer.from("hook v1") })
    await installStartupHook(installation)
    rmSync(join(installation, "Mods", "sombreterregate_0.3.0.zip"))
    seedMod("sombreterregate_0.2.0.zip", { "modinfo.json": Buffer.from("{}") })
    await installStartupHook(installation)
    assert.equal(existsSync(join(installation, STARTUP_HOOK_FOLDER)), false)
    assert.deepEqual(await startupHookEnvironment(installation), {})
  })

  it("ignores a hook in any other mod", async () => {
    seedMod("someothermod.zip", { [`native/${STARTUP_HOOK_FILE}`]: Buffer.from("not ours") })
    await installStartupHook(installation)
    assert.deepEqual(await startupHookEnvironment(installation), {})
  })
})
