import { ipcMain } from "electron"

import { IPC_CHANNELS } from "../ipcChannels"
import type { LauncherUpdateState } from "@src/domain/appUpdate/mandatoryUpdate"
import { assertTrustedIpcSender, isTrustedIpcSender } from "@src/ipc/ipcSecurity"

/**
 * The renderer's window onto the launcher's mandatory update (src/main/mandatoryUpdater.ts).
 *
 * The state lives here rather than in the controller so the renderer can ask for it before the
 * updater module has even loaded: main/index.ts publishes `checking` the moment it decides an update
 * check will run, and the home screen holds Play until that first answer. With no updater at all the
 * state stays `disabled`, which never blocks play.
 *
 * The renderer cannot start, skip or delay an update. It can only ask for a new attempt after
 * every automatic one failed, and for the restart the countdown would do a few seconds later anyway.
 */

export type SendToRenderer = (channel: string, payload?: unknown) => void

export interface LauncherUpdateActions {
  retryDownload: () => void
  installNow: () => void
}

let state: LauncherUpdateState = { status: "disabled" }
let send: SendToRenderer = () => {}
let actions: LauncherUpdateActions | undefined

/** Where state changes go. main/index.ts points it at the main window. */
export function setLauncherUpdateSender(sender: SendToRenderer): void {
  send = sender
}

/** The controller the two renderer requests reach, once the updater has loaded. */
export function setLauncherUpdateActions(controller: LauncherUpdateActions | undefined): void {
  actions = controller
}

export function publishLauncherUpdateState(next: LauncherUpdateState): void {
  state = next
  send(IPC_CHANNELS.APP_UPDATER.STATE_CHANGED, next)
}

export function getLauncherUpdateState(): LauncherUpdateState {
  return state
}

ipcMain.handle(IPC_CHANNELS.APP_UPDATER.GET_STATE, (event): LauncherUpdateState => {
  assertTrustedIpcSender(event)
  return state
})

ipcMain.on(IPC_CHANNELS.APP_UPDATER.RETRY_DOWNLOAD, (event) => {
  if (!isTrustedIpcSender(event)) return
  actions?.retryDownload()
})

ipcMain.on(IPC_CHANNELS.APP_UPDATER.INSTALL_NOW, (event) => {
  if (!isTrustedIpcSender(event)) return
  actions?.installNow()
})
