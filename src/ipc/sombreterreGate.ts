import { app, safeStorage, shell } from "electron"
import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import fse from "fs-extra"

import { CLIENT_SETTINGS_FILE_NAME, clientSettingsAccount } from "@domain/account/clientSettings"
import { formatServerEndpoint } from "@domain/servers/bookmarks"
import { SOMBRETERRE_PROFILE } from "@domain/sombreterre/profile"
import { getConfig } from "@src/config/configManager"
import { writeJsonAtomic } from "@src/ipc/atomicJsonFile"
import { BoundedResponseError, requestBoundedText } from "@src/ipc/network"
import { isRecord } from "@src/ipc/validation"
import { getErrorMessage, logMessage } from "@src/utils/logManager"

const LOG_PREFIX = "[back] [ipc] [ipc/sombreterreGate.ts]"

/** Encrypted with the OS keyring through safeStorage, beside the account store. */
const TOKEN_FILE_NAME = "sombreterre-gate.bin"
/** Read by the SombreterreGate.Client mod (GateClientSystem.TicketFileName) from the Installation's ModConfig. */
const TICKET_FILE_NAME = "sombreterre-ticket.json"

/** Sent with every request to the gate, which can turn away launchers older than it accepts. */
const LAUNCHER_VERSION_HEADER = "X-EoS-Launcher-Version"

const LINK_POLL_INTERVAL_MS = 2_000
const LINK_TIMEOUT_MS = 10 * 60_000

/**
 * Whether the launcher may talk to this address: https anywhere, or plain http to a loopback host
 * for local work. Shared by the gate and the pack sync, and only ever fed addresses from the profile.
 */
export function allowedSombreterreUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    if (url.username || url.password) return undefined
    if (url.protocol === "https:") return url
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return url
    return undefined
  } catch {
    return undefined
  }
}

function gateUrl(path: string): URL | undefined {
  const base = allowedSombreterreUrl(SOMBRETERRE_PROFILE.gateBaseUrl)
  return base ? new URL(path, base) : undefined
}

/** True when `url` is on the gate's origin, which is the only place the launcher token is ever sent. */
export function isGateOrigin(url: URL): boolean {
  const base = allowedSombreterreUrl(SOMBRETERRE_PROFILE.gateBaseUrl)
  return base !== undefined && base.origin === url.origin
}

type StoredLink = { token: string; discordName: string }

let cachedLink: StoredLink | null | undefined

function tokenPath(): string {
  return join(app.getPath("userData"), TOKEN_FILE_NAME)
}

export async function readGateLink(): Promise<StoredLink | null> {
  if (cachedLink !== undefined) return cachedLink
  try {
    if (!safeStorage.isEncryptionAvailable() || !(await fse.pathExists(tokenPath()))) return (cachedLink = null)
    const parsed: unknown = JSON.parse(safeStorage.decryptString(await fse.readFile(tokenPath())))
    cachedLink = isRecord(parsed) && typeof parsed["token"] === "string" ? { token: parsed["token"], discordName: typeof parsed["discordName"] === "string" ? parsed["discordName"] : "" } : null
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [readGateLink] Stored Discord link unreadable: ${getErrorMessage(error)}`)
    cachedLink = null
  }
  return cachedLink
}

async function saveGateLink(link: StoredLink | null): Promise<boolean> {
  cachedLink = link
  try {
    if (link === null) {
      await fse.remove(tokenPath())
      return true
    }
    // Never written in clear: without a keyring the link lasts for this session only.
    if (!safeStorage.isEncryptionAvailable()) return false
    await fse.writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(link)), { mode: 0o600 })
    return true
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [saveGateLink] Could not store the Discord link: ${getErrorMessage(error)}`)
    return false
  }
}

async function gateRequest(path: string, method: "GET" | "POST", options: { body?: unknown; auth?: boolean } = {}): Promise<unknown> {
  const url = gateUrl(path)
  if (!url) throw new Error("Gate address refused")
  const headers: Record<string, string> = { [LAUNCHER_VERSION_HEADER]: app.getVersion() }
  if (options.auth) {
    const link = await readGateLink()
    if (!link) throw new BoundedResponseError("Not linked", 401, {})
    headers["Authorization"] = `Bearer ${link.token}`
  }
  // A POST always carries a body: the gate's HttpListener answers 411 to one without a length.
  const body = options.body !== undefined ? JSON.stringify(options.body) : method === "POST" ? "{}" : undefined
  const text = await requestBoundedText(url, { method, headers, ...(body !== undefined ? { body } : {}) })
  return JSON.parse(text) as unknown
}

function statusOf(error: unknown): number | undefined {
  return error instanceof BoundedResponseError ? error.statusCode : undefined
}

export async function getGateStatus(): Promise<SombreterreServerStatus> {
  try {
    const body = await gateRequest("api/status", "GET")
    if (isRecord(body) && typeof body["online"] === "number" && typeof body["max"] === "number") return { ok: true, online: body["online"], max: body["max"] }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

/** Where the player stands: linked or not, and what the server says about their Discord account. */
export async function getGateAccount(): Promise<SombreterreAccountState> {
  const link = await readGateLink()
  if (!link) return { linked: false }
  try {
    const body = await gateRequest("api/me", "GET", { auth: true })
    const membership = isRecord(body) && typeof body["membership"] === "string" ? body["membership"] : "discord-unavailable"
    const discordName = isRecord(body) && typeof body["discordName"] === "string" ? body["discordName"] : link.discordName
    return { linked: true, discordName, membership: toMembership(membership) }
  } catch (error) {
    // The server no longer knows this token (revoked, or its store was reset): link again.
    if (statusOf(error) === 401) {
      await saveGateLink(null)
      return { linked: false }
    }
    return { linked: true, discordName: link.discordName, membership: "unreachable" }
  }
}

function toMembership(value: string): SombreterreMembership {
  return value === "whitelisted" || value === "not-whitelisted" || value === "not-member" ? value : "discord-unavailable"
}

/** Page the browser shows once it has come back to the launcher. */
const LINKED_PAGE =
  '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Compte Discord lié</title>' +
  '<body style="font-family:sans-serif;background:#18181b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h1>Compte Discord lié</h1><p>Tu peux fermer cet onglet et retourner dans le launcher.</p>' +
  '<p style="color:#a1a1aa">Discord account linked: you can close this tab and go back to the launcher.</p></div></body></html>'

export interface LoopbackListener {
  port: number
  /** Resolves with the handoff code the gate sent the browser back with. */
  handoff: Promise<string>
  close: () => void
}

/**
 * A one-time listener on this computer's loopback address (RFC 8252). After Discord, the gate sends
 * the browser here with a handoff code, and only a launcher holding that code can collect the token.
 * A link someone else was tricked into opening sends their browser to their own computer, never
 * to the launcher that started it.
 */
export function startLoopbackListener(): Promise<LoopbackListener> {
  return new Promise((resolve, reject) => {
    let deliver: (handoff: string) => void = () => {}
    const handoff = new Promise<string>((done) => (deliver = done))
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      const code = url.searchParams.get("handoff")
      if (request.method !== "GET" || url.pathname !== "/eos-link" || !code || !/^[A-Za-z0-9_-]{16,128}$/.test(code)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(LINKED_PAGE)
      deliver(code)
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as AddressInfo).port, handoff, close: () => server.close() })
    })
  })
}

function linkFailureReason(error: unknown): Extract<SombreterreLinkResult, { ok: false }>["reason"] {
  const status = statusOf(error)
  if (status === 426) return "launcher-outdated"
  if (status === 429) return "busy"
  if (status === 423) return "locked-down"
  if (status === 503) return "not-configured"
  return "unreachable"
}

/**
 * Links this launcher to a Discord account. The browser does the Discord part. The launcher proves
 * the session is its own twice: with a verifier it never sends until the end, and with the handoff
 * code its loopback listener receives from the browser (see {@link startLoopbackListener}).
 */
export async function linkDiscord(): Promise<SombreterreLinkResult> {
  const verifier = randomBytes(32).toString("base64url")
  const verifierHash = createHash("sha256").update(verifier, "utf8").digest("hex")

  let listener: LoopbackListener
  try {
    listener = await startLoopbackListener()
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [linkDiscord] Could not listen on the loopback address: ${getErrorMessage(error)}`)
    return { ok: false, reason: "unreachable" }
  }

  try {
    let session: string
    let url: string
    try {
      const body = await gateRequest("api/link/session", "POST", { body: { verifierHash, loopbackPort: listener.port } })
      if (!isRecord(body) || typeof body["session"] !== "string" || typeof body["url"] !== "string") return { ok: false, reason: "unreachable" }
      session = body["session"]
      url = body["url"]
    } catch (error) {
      return { ok: false, reason: linkFailureReason(error) }
    }

    // Only the gate's own start page is opened, whatever the server answered.
    const startUrl = allowedSombreterreUrl(url)
    if (!startUrl || !isGateOrigin(startUrl) || startUrl.pathname !== "/api/link/start") return { ok: false, reason: "unreachable" }
    await shell.openExternal(startUrl.toString())

    let handoff: string | undefined
    void listener.handoff.then((code) => (handoff = code))

    const deadline = Date.now() + LINK_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LINK_POLL_INTERVAL_MS))
      let body: unknown
      try {
        body = await gateRequest("api/link/poll", "POST", { body: { session, verifier, ...(handoff ? { handoff } : {}) } })
      } catch (error) {
        if (statusOf(error) === 404) return { ok: false, reason: "expired" }
        if (statusOf(error) === 426) return { ok: false, reason: "launcher-outdated" }
        continue
      }
      if (!isRecord(body)) continue
      if (body["status"] === "failed") return { ok: false, reason: "refused" }
      if (body["status"] === "linked" && typeof body["token"] === "string") {
        const discordName = typeof body["discordName"] === "string" ? body["discordName"] : ""
        const stored = await saveGateLink({ token: body["token"], discordName })
        return { ok: true, discordName, persisted: stored }
      }
    }
    return { ok: false, reason: "expired" }
  } finally {
    listener.close()
  }
}

export async function unlinkDiscord(): Promise<void> {
  try {
    await gateRequest("api/logout", "POST", { auth: true })
  } catch {
    // forgotten locally either way
  }
  await saveGateLink(null)
}

/** Headers for a request to the gate's own origin: the launcher version and, once linked, the token. */
export async function gateRequestHeaders(): Promise<Record<string, string>> {
  const link = await readGateLink()
  return { [LAUNCHER_VERSION_HEADER]: app.getVersion(), ...(link ? { Authorization: `Bearer ${link.token}` } : {}) }
}

/**
 * The game account this launch plays with: the launcher's active one, otherwise whoever logged in
 * inside the game. Only the name and UID are read out of the settings file.
 */
async function gameAccount(installationPath: string): Promise<{ playerUid: string; playerName: string } | undefined> {
  const config = await getConfig()
  const active = config.accounts.find((candidate) => candidate.playerUid === config.activeAccountId)
  if (active) return { playerUid: active.playerUid, playerName: active.playerName }
  const settings = await fse.readJson(join(installationPath, CLIENT_SETTINGS_FILE_NAME)).catch(() => undefined)
  return clientSettingsAccount(settings)
}

/**
 * Asks the server for a launch ticket and leaves it where the client mod reads it, in the
 * Installation's ModConfig, with the server address. One is fetched per launch; the server binds it to the
 * player's game account on first use, for the rest of that game session. The request names the game
 * account, which puts it on the server's whitelist while the Discord account holds the role.
 */
export async function prepareLaunchTicket(installationPath: string): Promise<SombreterreTicketResult> {
  const account = await gameAccount(installationPath)
  if (!account) return { ok: false, reason: "no-game-account" }

  let ticket: string
  try {
    const body = await gateRequest("api/ticket", "POST", { auth: true, body: account })
    if (!isRecord(body) || typeof body["ticket"] !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body["ticket"])) return { ok: false, reason: "unreachable" }
    ticket = body["ticket"]
  } catch (error) {
    const status = statusOf(error)
    if (status === 401) return { ok: false, reason: "not-linked" }
    if (status === 403) return { ok: false, reason: "not-whitelisted" }
    if (status === 409) return { ok: false, reason: "account-conflict" }
    if (status === 423) return { ok: false, reason: "locked-down" }
    if (status === 426) return { ok: false, reason: "launcher-outdated" }
    return { ok: false, reason: "unreachable" }
  }

  try {
    await fse.ensureDir(join(installationPath, "ModConfig"))
    // The server address lets the game's own Play button (client mod 0.2.0+) reconnect with this ticket.
    await writeJsonAtomic(join(installationPath, "ModConfig", TICKET_FILE_NAME), { Ticket: ticket, Server: formatServerEndpoint(SOMBRETERRE_PROFILE.server) })
    return { ok: true }
  } catch (error) {
    logMessage("warn", `${LOG_PREFIX} [prepareLaunchTicket] Could not write the launch ticket: ${getErrorMessage(error)}`)
    return { ok: false, reason: "write-failed" }
  }
}
