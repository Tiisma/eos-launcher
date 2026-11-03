import { useTranslation } from "react-i18next"
import { FiLoader } from "react-icons/fi"
import { PiDiscordLogoDuotone, PiGearDuotone, PiUsersDuotone } from "react-icons/pi"

import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { NormalButton, LinkButton } from "@renderer/components/ui/Buttons"
import ActivityCenter from "@renderer/components/ui/ActivityCenter"
import SessionButton from "@renderer/components/ui/SessionButton"
import logo from "@renderer/assets/sombreterre/logo.png"
import { useSombreterreGate } from "@renderer/features/sombreterre/hooks/useSombreterreGate"
import { useSombreterrePlay } from "@renderer/features/sombreterre/hooks/useSombreterrePlay"
import { useLauncherUpdate } from "@renderer/features/sombreterre/hooks/useLauncherUpdate"
import LauncherUpdateBanner from "@renderer/features/sombreterre/components/LauncherUpdateBanner"
import type { SombreterrePhase } from "@renderer/features/sombreterre/hooks/useSombreterrePlay"

const PHASE_KEYS: Record<Exclude<SombreterrePhase, "idle">, string> = {
  "installing-game": "features.sombreterre.phase.installingGame",
  "preparing-installation": "features.sombreterre.phase.preparingInstallation",
  "syncing-mods": "features.sombreterre.phase.syncingMods",
  playing: "features.sombreterre.phase.playing"
}

/**
 * The whole launcher as a player sees it: the server's name over its own background, the players
 * online, and one button. That button links Discord until the launcher is linked, then plays once
 * the server says the account is whitelisted. Account and settings stay reachable from the corners.
 * The launcher's own update is mandatory: while one is checked for, downloaded or installed, Play
 * waits and says why.
 */
function SombreterreHome(): JSX.Element {
  const { t } = useTranslation()
  const { phase, syncProgress, ready, play } = useSombreterrePlay()
  const gate = useSombreterreGate()
  const launcherUpdate = useLauncherUpdate()

  const busy = phase !== "idle"
  const linked = gate.account?.linked === true

  const statusLine =
    !busy && launcherUpdate.blocksPlay
      ? t(launcherUpdate.state === undefined || launcherUpdate.state.status === "checking" ? "features.sombreterre.launcherUpdate.checking" : "features.sombreterre.launcherUpdate.updating")
      : phase === "syncing-mods" && syncProgress && syncProgress.total > 0
        ? t("features.sombreterre.phase.syncingModsProgress", { done: syncProgress.done, total: syncProgress.total })
        : phase !== "idle"
          ? t(PHASE_KEYS[phase])
          : gate.account?.linked && gate.account.membership !== "whitelisted"
            ? t(`features.sombreterre.discord.membership.${gate.account.membership}`)
            : t("features.sombreterre.serverLine", { version: SOMBRETERRE_PROFILE.gameVersion })

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="flex items-center gap-2 w-72">
          <SessionButton />
          <ActivityCenter />
        </div>
        <div className="flex items-center gap-2">
          {gate.account?.linked && (
            <NormalButton
              title={t("features.sombreterre.discord.unlink")}
              size="md"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void gate.unlink()
              }}
            >
              <PiDiscordLogoDuotone />
              <span className="text-sm">{gate.account.discordName}</span>
            </NormalButton>
          )}
          <LinkButton to="/config" title={t("components.mainMenu.configTitle")} size="md" icon={<PiGearDuotone />} />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
        <img src={logo} alt="" className="w-40 h-40 rounded-lg shadow-lg shadow-zinc-950/60" />
        <h1 className="text-5xl font-bold tracking-wide drop-shadow-lg">{SOMBRETERRE_PROFILE.name}</h1>

        <p className="flex items-center gap-2 text-zinc-200 min-h-6">
          <PiUsersDuotone className="text-xl" />
          {gate.status === undefined
            ? t("features.sombreterre.players.loading")
            : gate.status.ok
              ? t("features.sombreterre.players.online", { online: gate.status.online, max: gate.status.max })
              : t("features.sombreterre.players.offline")}
        </p>

        {linked || gate.account === undefined ? (
          <NormalButton
            title={t("features.sombreterre.play")}
            variant="primary"
            size="lg"
            className="h-16 w-80 text-2xl"
            disabled={busy || !ready || !gate.canPlay || launcherUpdate.blocksPlay}
            onClick={() => {
              void play()
            }}
          >
            {busy ? <FiLoader className="animate-spin" /> : <p>{t("features.sombreterre.play")}</p>}
          </NormalButton>
        ) : (
          <NormalButton
            title={t("features.sombreterre.discord.link")}
            variant="primary"
            size="lg"
            className="h-16 w-80 text-xl"
            disabled={gate.linking}
            onClick={() => {
              void gate.link()
            }}
          >
            {gate.linking ? <FiLoader className="animate-spin" /> : <PiDiscordLogoDuotone className="text-3xl" />}
            <p>{gate.linking ? t("features.sombreterre.discord.linking") : t("features.sombreterre.discord.link")}</p>
          </NormalButton>
        )}

        <p className="text-zinc-300 text-sm min-h-5 max-w-lg">{!linked && gate.account !== undefined ? t("features.sombreterre.discord.why") : statusLine}</p>

        <LauncherUpdateBanner state={launcherUpdate.state} />
      </div>
    </div>
  )
}

export default SombreterreHome
