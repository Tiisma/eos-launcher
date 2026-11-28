import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { preferredBuild, shouldApplyOptimum } from "@domain/sombreterre/optimum"

const optimum = (version: string): { name: "Optimum"; version: string } => ({ name: "Optimum", version })
const manifest = (optimumVersion: string, supportedGameVersions = ["1.22.7"]): { optimumVersion: string; supportedGameVersions: string[] } => ({ optimumVersion, supportedGameVersions })

describe("shouldApplyOptimum", () => {
  it("leaves a build already on the wanted release alone", () => {
    assert.equal(shouldApplyOptimum(optimum("0.4.2"), "1.22.7", manifest("0.4.2")), false)
  })

  it("moves a build to the wanted release, forward or back", () => {
    assert.equal(shouldApplyOptimum(optimum("0.3.22"), "1.22.7", manifest("0.4.2")), true)
    assert.equal(shouldApplyOptimum(optimum("0.4.4"), "1.22.7", manifest("0.4.2")), true)
  })

  it("adds Optimum to a build without it when the release supports its game version", () => {
    assert.equal(shouldApplyOptimum(undefined, "1.22.7", manifest("0.4.2")), true)
    assert.equal(shouldApplyOptimum(undefined, "1.22.6", manifest("0.4.2")), false)
  })

  it("never applies a release that does not support the game version", () => {
    assert.equal(shouldApplyOptimum(optimum("0.3.22"), "1.22.7", manifest("0.5.0", ["1.23.0"])), false)
  })
})

describe("preferredBuild", () => {
  const plain: { id: string; variant?: { name: string; version: string } } = { id: "plain" }
  const patched = { id: "patched", variant: optimum("0.4.2") }

  it("takes the Optimum build when the player wants Optimum", () => {
    assert.equal(preferredBuild([plain, patched], true), patched)
  })

  it("takes the plain build when the player turned Optimum off", () => {
    assert.equal(preferredBuild([patched, plain], false), plain)
  })

  it("takes a plain build when Optimum is wanted and there is no Optimum build, since Play patches it", () => {
    assert.equal(preferredBuild([plain], true), plain)
  })

  it("never takes an Optimum build when Optimum is off, so a vanilla build gets installed beside it", () => {
    assert.equal(preferredBuild([patched], false), undefined)
  })

  it("finds nothing in an empty list", () => {
    assert.equal(preferredBuild([], true), undefined)
  })
})
