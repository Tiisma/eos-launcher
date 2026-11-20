import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { optimumMayNeedUpdate, shouldApplyOptimum } from "@domain/sombreterre/optimum"

const optimum = (version: string): { name: "Optimum"; version: string } => ({ name: "Optimum", version })
const manifest = (optimumVersion: string, supportedGameVersions = ["1.22.7"]): { optimumVersion: string; supportedGameVersions: string[] } => ({ optimumVersion, supportedGameVersions })

describe("optimumMayNeedUpdate", () => {
  it("leaves a build already on the pinned version alone, without the network", () => {
    assert.equal(optimumMayNeedUpdate(optimum("0.4.1"), "0.4.1"), false)
  })

  it("looks further for an older Optimum or a build without one", () => {
    assert.equal(optimumMayNeedUpdate(optimum("0.3.22"), "0.4.1"), true)
    assert.equal(optimumMayNeedUpdate(undefined, "0.4.1"), true)
  })

  it("does nothing for a pin that is not a version", () => {
    assert.equal(optimumMayNeedUpdate(optimum("0.3.22"), ""), false)
  })
})

describe("shouldApplyOptimum", () => {
  it("updates an older Optimum to a newer manifest for the same game version", () => {
    assert.equal(shouldApplyOptimum(optimum("0.3.22"), "1.22.7", manifest("0.4.1")), true)
  })

  it("adds Optimum to a build without it when the manifest supports its game version", () => {
    assert.equal(shouldApplyOptimum(undefined, "1.22.7", manifest("0.4.1")), true)
    assert.equal(shouldApplyOptimum(undefined, "1.22.6", manifest("0.4.1")), false)
  })

  it("never goes back, nor to a manifest that dropped the game version", () => {
    assert.equal(shouldApplyOptimum(optimum("0.4.2"), "1.22.7", manifest("0.4.1")), false)
    assert.equal(shouldApplyOptimum(optimum("0.3.22"), "1.22.7", manifest("0.4.1", ["1.23.0"])), false)
  })
})
