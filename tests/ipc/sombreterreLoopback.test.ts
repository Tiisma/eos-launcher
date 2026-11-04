import assert from "node:assert/strict"
import { describe, it } from "vitest"

import "./helpers/electronMock"

import { startLoopbackListener, ticketRenewalDelayMs } from "@src/ipc/sombreterreGate"

const HANDOFF = "a".repeat(43)

describe("ticketRenewalDelayMs", () => {
  it("renews at half the ticket's life, within bounds", () => {
    assert.equal(ticketRenewalDelayMs(21600), 3 * 60 * 60 * 1000)
    assert.equal(ticketRenewalDelayMs(10), 60_000)
    assert.equal(ticketRenewalDelayMs(10 * 24 * 60 * 60), 6 * 60 * 60 * 1000)
    assert.equal(ticketRenewalDelayMs(Number.NaN), 3 * 60 * 60 * 1000)
  })
})

describe("the Discord link's loopback listener", () => {
  it("listens on loopback only and hands over the code the browser brings back", async () => {
    const listener = await startLoopbackListener()
    try {
      assert.ok(listener.port > 0)

      const page = await fetch(`http://127.0.0.1:${listener.port}/eos-link?handoff=${HANDOFF}`)
      assert.equal(page.status, 200)
      assert.match(await page.text(), /Compte Discord lié/)
      assert.equal(await listener.handoff, HANDOFF)
    } finally {
      listener.close()
    }
  })

  it("answers nothing but its one path with a well-formed code", async () => {
    const listener = await startLoopbackListener()
    try {
      for (const path of ["/", "/eos-link", "/eos-link?handoff=short", `/eos-link?handoff=${"a".repeat(20)}%3Cscript%3E`, `/other?handoff=${HANDOFF}`]) {
        const response = await fetch(`http://127.0.0.1:${listener.port}${path}`)
        assert.equal(response.status, 404, path)
      }
      const settled = await Promise.race([listener.handoff.then(() => "resolved"), new Promise((resolve) => setTimeout(() => resolve("pending"), 50))])
      assert.equal(settled, "pending")
    } finally {
      listener.close()
    }
  })
})
