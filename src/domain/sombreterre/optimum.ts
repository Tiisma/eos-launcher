/**
 * Whether a build the launcher already installed should be patched with the Optimum release the server
 * (or, failing that, the launcher) wants. That release may be older than the installed one: going back
 * from a release that broke something is the point of choosing it.
 */

import { supportsGameVersion } from "../optimum/plan"
import type { OptimumManifest } from "../optimum/manifest"

/** True when `manifest` is another release than the build's (or the build has none) and supports its game version. */
export function shouldApplyOptimum(variant: { name: string; version: string } | undefined, gameVersion: string, manifest: Pick<OptimumManifest, "optimumVersion" | "supportedGameVersions">): boolean {
  if (!supportsGameVersion(manifest, gameVersion)) return false
  return variant?.name !== "Optimum" || variant.version !== manifest.optimumVersion
}

/**
 * Which of the usable builds of the Sombreterre game version Play should take.
 *
 * Optimum wanted: the Optimum build, or else a plain one, which Play then patches. Optimum off: a plain build
 * only, never an Optimum one, so Play installs a separate vanilla build beside it. Optimum cannot be taken back
 * out of a build in place: it overwrites the game's shaders without keeping a copy, and an incomplete restore
 * (vanilla assemblies next to Optimum's Cairo wrapper, say) crashes the game. Keeping both builds also makes
 * switching back and forth instant after the first download.
 */
export function preferredBuild<T extends { variant?: { name: string } }>(usable: readonly T[], wantOptimum: boolean): T | undefined {
  const isOptimum = (build: T): boolean => build.variant?.name === "Optimum"
  const matching = usable.find((build) => isOptimum(build) === wantOptimum)
  return wantOptimum ? (matching ?? usable[0]) : matching
}
