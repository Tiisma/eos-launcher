import { useTranslation } from "react-i18next"
import { FiLoader } from "react-icons/fi"
import { PiArrowClockwiseDuotone, PiDownloadSimpleDuotone, PiWarningDuotone } from "react-icons/pi"

import { LAUNCHER_RELEASES_URL } from "@domain/appUpdate/mandatoryUpdate"
import { NormalButton } from "@renderer/components/ui/Buttons"

/**
 * What the home screen shows while the launcher updates itself. Nothing is shown when there is no
 * update under way: the first check only changes the line under Play.
 */
function LauncherUpdateBanner({ state }: Readonly<{ state: LauncherUpdateState | undefined }>): JSX.Element | null {
  const { t } = useTranslation()
  if (state === undefined) return null

  switch (state.status) {
    case "downloading":
      return (
        <Banner>
          <p className="flex items-center gap-2">
            <FiLoader className="animate-spin shrink-0" />
            {t("features.sombreterre.launcherUpdate.downloading", { version: state.version, progress: state.progress })}
          </p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress} className="w-full h-2 rounded-sm bg-zinc-800 overflow-hidden">
            <div className="h-full bg-vsl transition-[width]" style={{ width: `${state.progress}%` }} />
          </div>
          <p className="text-xs text-zinc-300">{t("features.sombreterre.launcherUpdate.required")}</p>
        </Banner>
      )
    case "download-failed":
      return (
        <Banner>
          <p className="flex items-center gap-2">
            <PiWarningDuotone className="shrink-0 text-xl text-amber-400" />
            {t("features.sombreterre.launcherUpdate.downloadFailed", { version: state.version })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <NormalButton title={t("features.sombreterre.launcherUpdate.retry")} variant="primary" size="md" onClick={() => window.api.appUpdater.retryDownload()}>
              <PiArrowClockwiseDuotone />
              <span>{t("features.sombreterre.launcherUpdate.retry")}</span>
            </NormalButton>
            <NormalButton title={t("features.sombreterre.launcherUpdate.manualDownload")} variant="secondary" size="md" onClick={() => window.api.utils.openOnBrowser(LAUNCHER_RELEASES_URL)}>
              <PiDownloadSimpleDuotone />
              <span>{t("features.sombreterre.launcherUpdate.manualDownload")}</span>
            </NormalButton>
          </div>
        </Banner>
      )
    case "waiting-for-game":
      return (
        <Banner>
          <p>{t("features.sombreterre.launcherUpdate.waitingForGame", { version: state.version })}</p>
        </Banner>
      )
    case "installing":
      return (
        <Banner>
          <p className="flex items-center gap-2">
            <FiLoader className="animate-spin shrink-0" />
            {t("features.sombreterre.launcherUpdate.installing", { version: state.version, seconds: state.secondsLeft })}
          </p>
          <NormalButton title={t("features.sombreterre.launcherUpdate.restartNow")} variant="primary" size="md" disabled={state.secondsLeft <= 0} onClick={() => window.api.appUpdater.installNow()}>
            <span>{t("features.sombreterre.launcherUpdate.restartNow")}</span>
          </NormalButton>
        </Banner>
      )
    default:
      return null
  }
}

function Banner({ children }: Readonly<{ children: React.ReactNode }>): JSX.Element {
  return (
    <div role="status" className="w-full max-w-lg flex flex-col items-center gap-2 p-3 rounded-sm bg-zinc-950/80 border border-zinc-700 text-sm text-zinc-100">
      {children}
    </div>
  )
}

export default LauncherUpdateBanner
