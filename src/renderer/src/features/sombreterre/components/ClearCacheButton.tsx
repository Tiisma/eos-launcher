import { useState } from "react"
import { useTranslation } from "react-i18next"
import { PiBroomDuotone } from "react-icons/pi"

import ConfirmDialog from "@renderer/components/ui/ConfirmDialog"
import { NormalButton } from "@renderer/components/ui/Buttons"
import { useNotificationsContext } from "@renderer/contexts/NotificationsContext"

/** Deletes the game's Cache folder, after asking. The game fills it again the next time it runs. */
function ClearCacheButton({ disabled }: Readonly<{ disabled: boolean }>): JSX.Element {
  const { t } = useTranslation()
  const { addNotification } = useNotificationsContext()
  const [open, setOpen] = useState(false)

  async function clear(): Promise<void> {
    setOpen(false)
    const result = await window.api.sombreterre.clearGameCache()
    if (result.ok) addNotification(t("features.sombreterre.clearCache.done"), "success")
    else addNotification(t(`features.sombreterre.clearCache.failed.${result.reason}`), "error")
  }

  return (
    <>
      <NormalButton title={t("features.sombreterre.clearCache.title")} size="md" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        <PiBroomDuotone />
        <span className="text-sm">{t("features.sombreterre.clearCache.title")}</span>
      </NormalButton>
      <ConfirmDialog
        title={t("features.sombreterre.clearCache.title")}
        isOpen={open}
        close={() => setOpen(false)}
        question={t("features.sombreterre.clearCache.question")}
        consequence={t("features.sombreterre.clearCache.consequence")}
        confirmLabel={t("features.sombreterre.clearCache.confirm")}
        confirmIcon={<PiBroomDuotone />}
        onConfirm={clear}
      />
    </>
  )
}

export default ClearCacheButton
