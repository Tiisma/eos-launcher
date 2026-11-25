import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { PiHandHeartDuotone, PiXCircleDuotone } from "react-icons/pi"

import PopupDialogPanel from "@renderer/components/ui/PopupDialogPanel"
import { ButtonsWrapper, FormButton } from "@renderer/components/ui/FormComponents"

/**
 * Asks once whether the player agrees to send anonymous technical data. Neither answer is chosen for
 * them, and nothing is sent until they say yes. Closing the dialog without answering asks again at
 * the next start. The answer can be changed in the settings.
 */
function MetricsConsentDialog(): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.sombreterre.metricsConsent().then((consent) => {
      if (!cancelled && consent === "unanswered") setOpen(true)
    })
    return (): void => {
      cancelled = true
    }
  }, [])

  // The project's own locales only (French and English): the Sombreterre screens are not in the others.
  const yesLabel = t("features.sombreterre.metrics.yes")
  const noLabel = t("features.sombreterre.metrics.no")

  function answer(consent: boolean): void {
    setOpen(false)
    void window.api.sombreterre.setMetricsConsent(consent)
  }

  return (
    <PopupDialogPanel title={t("features.sombreterre.metrics.title")} isOpen={open} close={() => setOpen(false)}>
      <>
        <p>{t("features.sombreterre.metrics.question")}</p>
        <p>{t("features.sombreterre.metrics.why")}</p>
        <p className="text-zinc-400">{t("features.sombreterre.metrics.privacy")}</p>
        <ButtonsWrapper className="text-base" bgDark={false} equalWidth flush>
          <FormButton title={noLabel} onClick={() => answer(false)} variant="secondary" size="md" icon={<PiXCircleDuotone />} />
          <FormButton title={yesLabel} onClick={() => answer(true)} variant="primary" size="md" icon={<PiHandHeartDuotone />} />
        </ButtonsWrapper>
      </>
    </PopupDialogPanel>
  )
}

export default MetricsConsentDialog
