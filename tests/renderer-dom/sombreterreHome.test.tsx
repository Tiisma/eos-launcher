import { describe, expect, it, vi } from "vitest"
import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { TaskProvider } from "@renderer/contexts/TaskManagerContext"
import SombreterreHome from "@renderer/features/sombreterre/pages/SombreterreHome"

import { installMockWindowApi } from "./helpers/windowApi"
import { renderWithProviders } from "./helpers/render"

function renderHome(
  account: SombreterreAccountState,
  status: SombreterreServerStatus = { ok: true, online: 4, max: 32 },
  update: LauncherUpdateState = { status: "up-to-date" }
): ReturnType<typeof installMockWindowApi> {
  const api = installMockWindowApi({
    sombreterre: {
      accountState: vi.fn(async () => account),
      serverStatus: vi.fn(async () => status),
      linkDiscord: vi.fn(async () => ({ ok: true as const, discordName: "alice", persisted: true }))
    },
    appUpdater: {
      getState: vi.fn(async () => update)
    }
  })
  renderWithProviders(
    <TaskProvider>
      <SombreterreHome />
    </TaskProvider>
  )
  return api
}

const WHITELISTED: SombreterreAccountState = { linked: true, discordName: "alice", membership: "whitelisted" }

describe("the Sombreterre home screen", () => {
  it("asks an unlinked launcher to link Discord instead of offering Play", async () => {
    const api = renderHome({ linked: false })

    const link = await screen.findByRole("button", { name: "Link my Discord" })
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull()

    await userEvent.setup().click(link)
    await waitFor(() => expect(api.sombreterre.linkDiscord).toHaveBeenCalledTimes(1))
  })

  it("keeps Play locked and says why while the whitelist is pending", async () => {
    renderHome({ linked: true, discordName: "alice", membership: "not-whitelisted" })

    expect(await screen.findByText("Your whitelist has not been validated yet. Check The Exiles of Shadowland Discord.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the players online", async () => {
    renderHome({ linked: true, discordName: "alice", membership: "whitelisted" })

    expect(await screen.findByText("4 / 32 players online")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Unlink Discord" })).toBeTruthy()
  })

  it("offers Play once the launcher is known to be up to date", async () => {
    renderHome(WHITELISTED)

    await waitFor(() => expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false))
  })

  it("lets play through when the update check could not reach GitHub", async () => {
    renderHome(WHITELISTED, undefined, { status: "check-failed" })

    await waitFor(() => expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false))
  })

  it("blocks Play and shows the progress while the launcher updates itself", async () => {
    renderHome(WHITELISTED, undefined, { status: "downloading", version: "0.1.2", progress: 42 })

    expect(await screen.findByText("Updating the launcher…")).toBeTruthy()
    expect(screen.getByText("Downloading EoS Launcher 0.1.2: 42%")).toBeTruthy()
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42")
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("follows the state the main process pushes, up to the restart countdown", async () => {
    let push: (state: LauncherUpdateState) => void = () => {}
    const api = installMockWindowApi({
      sombreterre: {
        accountState: vi.fn(async () => WHITELISTED),
        serverStatus: vi.fn(async () => ({ ok: true as const, online: 4, max: 32 }))
      },
      appUpdater: {
        getState: vi.fn(async () => ({ status: "checking" }) as LauncherUpdateState),
        onStateChanged: vi.fn((callback: (state: LauncherUpdateState) => void) => {
          push = callback
          return (): void => {}
        })
      }
    })
    renderWithProviders(
      <TaskProvider>
        <SombreterreHome />
      </TaskProvider>
    )

    expect(await screen.findByText("Checking for a launcher update…")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true)

    act(() => push({ status: "installing", version: "0.1.2", secondsLeft: 7 }))
    expect(await screen.findByText("EoS Launcher 0.1.2 is ready. Restarting in 7 s to install it…")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true)

    await userEvent.setup().click(screen.getByRole("button", { name: "Restart now" }))
    expect(api.appUpdater.installNow).toHaveBeenCalledTimes(1)
  })

  it("offers a retry and the manual download when the update could not be downloaded", async () => {
    const api = renderHome(WHITELISTED, undefined, { status: "download-failed", version: "0.1.2" })

    const retry = await screen.findByRole("button", { name: "Retry" })
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true)

    const user = userEvent.setup()
    await user.click(retry)
    expect(api.appUpdater.retryDownload).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "Download it by hand" }))
    expect(api.utils.openOnBrowser).toHaveBeenCalledWith("https://github.com/Tiisma/eos-launcher/releases/latest")
  })

  it("says the update waits for the game to close", async () => {
    renderHome(WHITELISTED, undefined, { status: "waiting-for-game", version: "0.1.2" })

    expect(await screen.findByText("EoS Launcher 0.1.2 is ready. It installs as soon as the game is closed.")).toBeTruthy()
  })

  it("lets a linked player pick the optional mods the server offers, and shows nothing when there are none", async () => {
    const api = renderHome({ linked: true, discordName: "alice", membership: "whitelisted" })
    await act(async () => {})
    expect(screen.queryByRole("button", { name: /optional mods/i })).toBeNull()
    expect(api.sombreterre.optionalMods).toHaveBeenCalled()
  })

  it("saves a ticked optional mod", async () => {
    const choose = vi.fn(async () => undefined)
    installMockWindowApi({
      sombreterre: {
        accountState: vi.fn(async () => ({ linked: true as const, discordName: "alice", membership: "whitelisted" as const })),
        serverStatus: vi.fn(async () => ({ ok: true as const, online: 1, max: 2 })),
        optionalMods: vi.fn(async () => [{ modid: "shaders", version: "2.0.0", name: "Nice shaders", description: "Pretty light", chosen: false }]),
        chooseOptionalMod: choose
      },
      appUpdater: { getState: vi.fn(async () => ({ status: "up-to-date" as const })) }
    })
    renderWithProviders(
      <TaskProvider>
        <SombreterreHome />
      </TaskProvider>
    )
    await userEvent.click(await screen.findByRole("button", { name: /optional mods/i }))
    await userEvent.click(await screen.findByRole("checkbox", { name: /nice shaders/i }))
    await waitFor(() => expect(choose).toHaveBeenCalledWith("shaders", true))
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /nice shaders/i }) as HTMLInputElement).checked).toBe(true))
  })

  it("clears the game cache only after asking", async () => {
    const api = renderHome({ linked: true, discordName: "alice", membership: "whitelisted" })
    const clear = api.sombreterre.clearGameCache as ReturnType<typeof vi.fn>
    clear.mockResolvedValue({ ok: true })
    await userEvent.click(await screen.findByRole("button", { name: /clear cache/i }))
    expect(clear).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole("button", { name: /^clear$/i }))
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
  })
})
