/**
 * Whether a build the launcher already installed still needs Optimum brought to the version the profile
 * pins. Asked on every Play, so it decides without the network: only a build already on that exact
 * version is left alone without looking at the published manifest.
 */

import semver from "semver"

import { isUpdateAvailable, supportsGameVersion } from "../optimum/plan"
import type { OptimumManifest } from "../optimum/manifest"

/** True unless the build already runs the pinned Optimum. A build without Optimum needs it too. */
export function optimumMayNeedUpdate(variant: { name: string; version: string } | undefined, pinnedVersion: string): boolean {
  if (!semver.valid(pinnedVersion)) return false
  return variant?.name !== "Optimum" || variant.version !== pinnedVersion
}

/**
 * True when `manifest` should be applied to the build: a build without Optimum gets it where the
 * manifest supports its game version; one with Optimum only when the manifest is newer. A build already
 * on a newer Optimum than the manifest, put there by hand, is left as it is.
 */
export function shouldApplyOptimum(variant: { name: string; version: string } | undefined, gameVersion: string, manifest: Pick<OptimumManifest, "optimumVersion" | "supportedGameVersions">): boolean {
  if (variant?.name !== "Optimum") return supportsGameVersion(manifest, gameVersion)
  return isUpdateAvailable(variant.version, gameVersion, manifest)
}
