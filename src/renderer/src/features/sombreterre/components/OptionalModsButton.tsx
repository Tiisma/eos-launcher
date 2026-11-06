import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { PiPuzzlePieceDuotone } from "react-icons/pi"

import { NormalButton } from "@renderer/components/ui/Buttons"

/** How soon to ask again after the server did not answer, as while it restarts. */
const RETRY_AFTER_FAILURE_MS = 15_000
/** How often to pick up mods the server added while the launcher stays open. */
const REFRESH_MS = 5 * 60_000

/**
 * The optional Mods the server offers, each with a box to tick. Shown only when there are some.
 * A choice is saved straight away and takes effect at the next Play, when the pack is synced.
 * The list keeps being asked for, so a server that was down when the launcher opened still gets its
 * button, and a failed attempt leaves the list already shown in place.
 */
function OptionalModsButton({ disabled }: { disabled: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  const [mods, setMods] = useState<SombreterreOptionalMod[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      const list = await window.api.sombreterre.optionalMods()
      if (!current) return
      if (list) setMods(list)
      timer = setTimeout(() => void refresh(), list ? REFRESH_MS : RETRY_AFTER_FAILURE_MS)
    }
    void refresh()
    return (): void => {
      current = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  async function choose(modid: string, chosen: boolean): Promise<void> {
    await window.api.sombreterre.chooseOptionalMod(modid, chosen)
    setMods((list) => list.map((mod) => (mod.modid === modid ? { ...mod, chosen } : mod)))
  }

  if (mods.length === 0) return null

  return (
    <>
      <NormalButton title={t("features.sombreterre.optionalMods.title")} size="md" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        <PiPuzzlePieceDuotone />
        <span className="text-sm">{t("features.sombreterre.optionalMods.title")}</span>
      </NormalButton>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70" role="dialog" aria-modal="true" aria-label={t("features.sombreterre.optionalMods.title")}>
          <div className="w-[32rem] max-h-[80vh] overflow-y-auto rounded-lg bg-zinc-900 p-6 text-left shadow-lg flex flex-col gap-4">
            <h2 className="text-xl font-bold">{t("features.sombreterre.optionalMods.title")}</h2>
            <p className="text-sm text-zinc-300">{t("features.sombreterre.optionalMods.why")}</p>
            <ul className="flex flex-col gap-3">
              {mods.map((mod) => (
                <li key={mod.modid}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={mod.chosen}
                      onChange={(event) => {
                        void choose(mod.modid, event.target.checked)
                      }}
                    />
                    <span>
                      <span className="font-medium">{mod.name}</span> <span className="text-xs text-zinc-400">{mod.version}</span>
                      {mod.description && <span className="block text-sm text-zinc-300">{mod.description}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <NormalButton title={t("features.sombreterre.optionalMods.close")} size="md" variant="primary" onClick={() => setOpen(false)}>
                <span className="text-sm">{t("features.sombreterre.optionalMods.close")}</span>
              </NormalButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default OptionalModsButton
