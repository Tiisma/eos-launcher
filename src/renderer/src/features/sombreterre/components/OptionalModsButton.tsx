import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { PiPuzzlePieceDuotone } from "react-icons/pi"

import { NormalButton } from "@renderer/components/ui/Buttons"

/**
 * The optional Mods the server offers, each with a box to tick. Shown only when there are some.
 * A choice is saved straight away and takes effect at the next Play, when the pack is synced.
 */
function OptionalModsButton({ disabled }: { disabled: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  const [mods, setMods] = useState<SombreterreOptionalMod[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let current = true
    void window.api.sombreterre.optionalMods().then((list) => {
      if (current) setMods(list)
    })
    return () => {
      current = false
    }
  }, [])

  if (mods.length === 0) return null

  async function choose(modid: string, chosen: boolean): Promise<void> {
    await window.api.sombreterre.chooseOptionalMod(modid, chosen)
    setMods((list) => list.map((mod) => (mod.modid === modid ? { ...mod, chosen } : mod)))
  }

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
