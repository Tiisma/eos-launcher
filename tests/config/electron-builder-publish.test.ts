import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it } from "vitest"

/**
 * Guards the update feed electron-builder writes into the packaged resources/app-update.yml.
 *
 * The launcher updates itself, without asking (src/main/mandatoryUpdater.ts), from whatever this
 * block names. Pointing it anywhere but this fork's own releases would replace the launcher with
 * somebody else's build on every player's machine, so the exact feed is pinned here.
 */
describe("electron-builder publish feed", () => {
  const root = resolve(__dirname, "../..")
  const yml = readFileSync(resolve(root, "electron-builder.yml"), "utf8")

  it("points at this fork's GitHub releases", () => {
    assert.match(yml, /^publish:\n {2}provider: github\n {2}owner: Tiisma\n {2}repo: eos-launcher\n/m)
  })

  it("declares one feed, and not upstream RiftLauncher's", () => {
    assert.equal(yml.match(/^publish:/gm)?.length, 1)
    assert.doesNotMatch(yml, /^\s*(owner|repo):\s*"?(StratumServer|RiftLauncher)"?\s*$/im)
  })
})
