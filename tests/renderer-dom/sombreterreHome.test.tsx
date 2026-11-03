import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { TaskProvider } from "@renderer/contexts/TaskManagerContext"
import SombreterreHome from "@renderer/features/sombreterre/pages/SombreterreHome"

import { installMockWindowApi } from "./helpers/windowApi"
import { renderWithProviders } from "./helpers/render"

function renderHome(account: SombreterreAccountState, status: SombreterreServerStatus = { ok: true, online: 4, max: 32 }): ReturnType<typeof installMockWindowApi> {
  const api = installMockWindowApi({
    sombreterre: {
      accountState: vi.fn(async () => account),
      serverStatus: vi.fn(async () => status),
      linkDiscord: vi.fn(async () => ({ ok: true as const, discordName: "alice", persisted: true }))
    }
  })
  renderWithProviders(
    <TaskProvider>
      <SombreterreHome />
    </TaskProvider>
  )
  return api
}

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
})
