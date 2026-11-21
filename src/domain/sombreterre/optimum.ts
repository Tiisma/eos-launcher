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
