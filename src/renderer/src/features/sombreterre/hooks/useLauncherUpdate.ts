import { useEffect, useState } from "react"

import { updateBlocksPlay } from "@domain/appUpdate/mandatoryUpdate"

export interface LauncherUpdate {
  /** Undefined until the main process has answered, a local round trip. */
  state: LauncherUpdateState | undefined
  /** Whether Play has to wait for the launcher's own update. */
  blocksPlay: boolean
}

/**
 * The launcher's mandatory update, as the main process reports it (src/main/mandatoryUpdater.ts).
 *
 * Pulled once on mount, then pushed: the home screen can mount after the first change was sent. A
 * push that lands before the pull answers wins, since it is the newer of the two.
 */
export function useLauncherUpdate(): LauncherUpdate {
  const [state, setState] = useState<LauncherUpdateState | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    let pushed = false

    const unsubscribe = window.api.appUpdater.onStateChanged((next) => {
      pushed = true
      setState(next)
    })

    window.api.appUpdater.getState().then(
      (current) => {
        if (!cancelled && !pushed) setState(current)
      },
      () => {
        // The bridge itself failed: nothing is known about an update, so play stays open.
        if (!cancelled && !pushed) setState({ status: "check-failed" })
      }
    )

    return (): void => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { state, blocksPlay: updateBlocksPlay(state) }
}
