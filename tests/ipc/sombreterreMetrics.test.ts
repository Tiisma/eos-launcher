import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it, vi } from "vitest"

import { setElectronUserDataPath } from "./helpers/electronMock"

const state = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }))
vi.mock("@src/ipc/sombreterreGate", () => ({
  postGateMetrics: vi.fn(async (report: Record<string, unknown>) => {
    state.sent.push(report)
    return true
  })
}))
vi.mock("@src/config/configManager", () => ({
  getConfig: vi.fn(async () => ({ accounts: [{ email: "alice@example.com", playerName: "AliceTheBrave", playerUid: "uid-alice-0001" }] }))
}))

type Metrics = typeof import("@src/ipc/sombreterreMetrics")

describe("anonymous metrics", () => {
  let userData: string
  let installation: string
  let metrics: Metrics

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), "eos-metrics-user-"))
    installation = mkdtempSync(join(tmpdir(), "eos-metrics-inst-"))
    setElectronUserDataPath(userData)
    state.sent = []
    // The answer is cached per process: every test starts from a fresh module.
    vi.resetModules()
    metrics = await import("@src/ipc/sombreterreMetrics")
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(installation, { recursive: true, force: true })
  })

  it("sends nothing until the player answers yes", async () => {
    assert.equal(await metrics.getMetricsConsent(), "unanswered")
    await metrics.reportLaunch({ syncSeconds: 3 })
    assert.equal(state.sent.length, 0)

    await metrics.setMetricsConsent(false)
    await metrics.reportLaunch({ syncSeconds: 3 })
    assert.equal(state.sent.length, 0)
    assert.equal(await metrics.getMetricsConsent(), "no")
  })

  it("tells the client mod the answer through the Installation", async () => {
    await metrics.writeGameConsent(installation)
    assert.deepEqual(JSON.parse(readFileSync(join(installation, "ModConfig", metrics.GAME_CONSENT_FILE_NAME), "utf8")), { Consent: false })
    await metrics.setMetricsConsent(true)
    await metrics.writeGameConsent(installation)
    assert.deepEqual(JSON.parse(readFileSync(join(installation, "ModConfig", metrics.GAME_CONSENT_FILE_NAME), "utf8")), { Consent: true })
  })

  it("reports a launch with hardware and durations, and nothing that names the player", async () => {
    await metrics.setMetricsConsent(true)
    await metrics.reportLaunch({ installSeconds: 120.5, syncSeconds: 8, launchError: "ticket:not-whitelisted" })
    const report = state.sent[0] as Record<string, unknown>
    assert.equal(report["kind"], "launcher")
    assert.equal(report["syncSeconds"], 8)
    assert.equal(report["launchError"], "ticket:not-whitelisted")
    assert.equal(typeof report["ramGb"], "number")
    const text = JSON.stringify(report)
    assert.ok(!text.includes("AliceTheBrave"))
    assert.ok(!text.includes("alice@example.com"))
    assert.ok(!text.includes("uid-alice-0001"))
  })

  it("reports a crash of this session, cleaned, and leaves an older one alone", async () => {
    await metrics.setMetricsConsent(true)
    mkdirSync(join(installation, "Logs"))
    const crash = join(installation, "Logs", "client-crash.txt")
    writeFileSync(
      crash,
      [
        "Critical error occurred in the following mod: somemod@1.2.3",
        "System.NullReferenceException: AliceTheBrave broke it at C:\\Users\\Alice\\VintagestoryData\\x.cs",
        "   at SomeMod.Thing.Run() in C:\\Users\\Alice\\src\\Thing.cs:line 3",
        "   at Vintagestory.Client.ClientMain.Tick()"
      ].join("\n")
    )

    const launchedAt = Date.now() - 60_000
    utimesSync(crash, new Date(launchedAt - 3_600_000), new Date(launchedAt - 3_600_000))
    await metrics.reportGameCrash(installation, launchedAt)
    assert.equal(state.sent.length, 0)

    utimesSync(crash, new Date(), new Date())
    await metrics.reportGameCrash(installation, launchedAt)
    const report = state.sent[0] as Record<string, unknown>
    assert.equal(report["kind"], "crash")
    assert.equal(report["errorType"], "System.NullReferenceException")
    assert.equal(report["mod"], "somemod")
    const trace = String(report["trace"])
    assert.ok(trace.includes("SomeMod.Thing.Run()"))
    assert.ok(!trace.includes("AliceTheBrave"))
    assert.ok(!trace.includes("Alice\\"))
  })
})
