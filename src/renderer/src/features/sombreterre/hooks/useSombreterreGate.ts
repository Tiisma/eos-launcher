import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useNotificationsContext } from "@renderer/contexts/NotificationsContext"

const STATUS_REFRESH_MS = 30_000
const ACCOUNT_REFRESH_MS = 60_000

export interface SombreterreGate {
  /** Undefined until the first answer. */
  account: SombreterreAccountState | undefined
  status: SombreterreServerStatus | undefined
  linking: boolean
  /** True once the server says this Discord account may play. */
  canPlay: boolean
  link: () => Promise<void>
  unlink: () => Promise<void>
  refreshAccount: () => Promise<void>
}

/**
 * The Discord side of the home screen: is this launcher linked, may that account play, and how many
 * players are on. The account is checked again every minute, so a whitelist validated on Discord
 * unlocks Play without a restart.
 */
export function useSombreterreGate(): SombreterreGate {
  const { t } = useTranslation()
  const { addNotification } = useNotificationsContext()

  const [account, setAccount] = useState<SombreterreAccountState | undefined>()
  const [status, setStatus] = useState<SombreterreServerStatus | undefined>()
  const [linking, setLinking] = useState(false)

  const refreshAccount = useCallback(async (): Promise<void> => {
    setAccount(await window.api.sombreterre.accountState())
  }, [])

  useEffect(() => {
    let cancelled = false
    const readStatus = async (): Promise<void> => {
      const next = await window.api.sombreterre.serverStatus()
      if (!cancelled) setStatus(next)
    }
    const readAccount = async (): Promise<void> => {
      const next = await window.api.sombreterre.accountState()
      if (!cancelled) setAccount(next)
    }
    void readStatus()
    void readAccount()
    const statusTimer = window.setInterval(() => void readStatus(), STATUS_REFRESH_MS)
    const accountTimer = window.setInterval(() => void readAccount(), ACCOUNT_REFRESH_MS)
    return (): void => {
      cancelled = true
      window.clearInterval(statusTimer)
      window.clearInterval(accountTimer)
    }
  }, [])

  async function link(): Promise<void> {
    if (linking) return
    setLinking(true)
    try {
      const result = await window.api.sombreterre.linkDiscord()
      if (result.ok) {
        addNotification(t("features.sombreterre.discord.linked", { name: result.discordName }), "success")
        if (!result.persisted) addNotification(t("features.sombreterre.discord.notPersisted"), "warning")
      } else {
        addNotification(t(`features.sombreterre.discord.linkFailed.${result.reason}`), "error")
      }
      await refreshAccount()
    } finally {
      setLinking(false)
    }
  }

  async function unlink(): Promise<void> {
    await window.api.sombreterre.unlinkDiscord()
    await refreshAccount()
  }

  const canPlay = account?.linked === true && account.membership === "whitelisted"

  return { account, status, linking, canPlay, link, unlink, refreshAccount }
}
