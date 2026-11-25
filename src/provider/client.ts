/**
 * The provider client: Wispr Flow's MCP server, its tools and the sign-in OpenCode holds for each account.
 *
 * This is the only file that names a vendor address. The vendor's MCP server holds the credentials; OpenCode registers
 * one server per alias (`wisprflow`, `wisprflow-<alias>`) and keys OAuth by server, so this module only says which
 * server and tool belong to an alias, reads the sign-in through the public host APIs, and maps a failure to the
 * contract's error table. Nothing here keeps a token, a cache or a cursor: the consumer owns the cursor.
 */
import { accountName, redactReason, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { probeResult, SourceError, type EventsListResult, type EventsOwner, type ProbeResult } from "@we-the-rebel-alliance/plugin-contract/events"
import { listEvents, meetingsList, resultData, SOURCE, type MeetingsList, type Search } from "./meetings.ts"

/** Wispr Flow's MCP server, exactly this string: with a trailing slash its sign-in does not start. */
export const MCP_URL = "https://api.wisprflow.ai/connect/mcp"

/** The server's status, as OpenCode reports it. */
export interface ServerStatus {
  readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"
  readonly error?: string
}

/** One registered MCP server, as the host lists it. */
export interface ServerInfo {
  readonly name: string
  readonly status: ServerStatus
  readonly integrationID?: string
}

/** The sign-in OpenCode holds for one integration: a credential, with a stable id and a display label. */
export interface ConnectionInfo {
  readonly type: string
  readonly id?: string
  readonly label?: string
}

/** One tool the host has registered, including the vendor server's own. */
export interface ToolInfo {
  readonly id: string
  execute(input: unknown, context: unknown): Promise<unknown>
}

/** The host calls the provider reads. A real setup passes OpenCode's own; a test passes its own. */
export interface Host {
  tools(): Promise<readonly ToolInfo[]>
  servers(): Promise<readonly ServerInfo[]>
  activeConnection(integrationID: string): Promise<ConnectionInfo | undefined>
}

/** What the provider needs from one handler call: the vendor tool runs as this session and agent. */
export interface CallContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  progress(update?: Readonly<Record<string, unknown>>): Promise<void>
}

export interface Provider {
  /** One account's page of meetings, oldest first. */
  page(input: { readonly account: string; readonly input: unknown; readonly now: number; readonly call: CallContext }): Promise<EventsListResult>
  /** One account's meetings as the registry's `list` snapshot. */
  list(input: { readonly account: string; readonly input: Record<string, unknown>; readonly now: number; readonly call: CallContext }): Promise<MeetingsList>
  /** The signed-in owner of one account, and no content. */
  probe(input: { readonly account: string }): Promise<ProbeResult>
  /** The owner every page and probe names. */
  owner(input: { readonly account: string }): Promise<EventsOwner>
  /** One account's state for `status`; never throws. */
  signal(input: { readonly account: string }): Promise<AccountSignal>
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const SIGN_IN = (name: string) => `Run /connect and sign the ${name} MCP server in, then try again.`
const SERVER_UP = "Restart OpenCode; if the server stays missing, read the plugin's status for its next step."

/** One non-empty line for an owner's label: control characters become spaces, and it is cut to the contract's 200. */
function labelOf(value: string | undefined): string {
  const clean = (value ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim()
  return clean === "" ? "Wispr Flow sign-in" : clean.slice(0, 200)
}

/**
 * OpenCode's sign-in for one alias's server. The owner is unverified and says so: Wispr Flow names no account, so its
 * id is always the credential's own id, which a new sign-in changes, and its label, for display only, the credential's
 * label. A label does not identify a connection and can be renamed, so it never becomes the id.
 */
async function ownerFor(host: Host, name: string): Promise<EventsOwner> {
  const server = (await host.servers()).find((entry) => entry.name === name)
  if (server === undefined) {
    throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is not registered`, next: SERVER_UP })
  }
  if (server.status.status === "needs_auth") {
    throw new SourceError({ code: "NEEDS_SIGN_IN", what: `the ${name} MCP server needs a sign-in`, next: SIGN_IN(name) })
  }
  if (server.status.status === "pending") {
    throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is still connecting`, next: "Call again in a few seconds." })
  }
  if (server.status.status === "failed") {
    throw new SourceError({
      code: "UNAVAILABLE",
      what: `the ${name} MCP server could not connect: ${redactReason(server.status.error ?? "no reason given")}`,
      next: "Check your network, then read the plugin's status.",
    })
  }
  if (server.status.status === "disabled") {
    throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is disabled`, next: `Enable ${name} in /mcps, or remove its disabled setting.` })
  }
  const connection = server.integrationID === undefined ? undefined : await host.activeConnection(server.integrationID).catch(() => undefined)
  if (connection?.type !== "credential" || typeof connection.id !== "string" || connection.id === "") {
    throw new SourceError({ code: "NEEDS_SIGN_IN", what: `OpenCode holds no ${name} sign-in`, next: SIGN_IN(name) })
  }
  return { id: `wisprflow:credential:${encodeURIComponent(connection.id)}`, label: labelOf(connection.label), verified: false }
}

/** The one vendor tool this plugin reads through, and the account it runs as. */
function searcherFor(host: Host, name: string, call: CallContext): Search {
  let tool: ToolInfo | undefined
  return async (input) => {
    call.signal.throwIfAborted()
    const server = (await host.servers()).find((entry) => entry.name === name)
    if (server === undefined) {
      throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is not registered`, next: SERVER_UP })
    }
    if (server.status.status === "needs_auth") {
      throw new SourceError({ code: "NEEDS_SIGN_IN", what: `the ${name} MCP server needs a sign-in`, next: SIGN_IN(name) })
    }
    if (server.status.status === "failed") {
      throw new SourceError({
        code: "UNAVAILABLE",
        what: `the ${name} MCP server could not connect: ${redactReason(server.status.error ?? "no reason given")}`,
        next: "Call again with the same cursor; if it keeps failing, read the plugin's status.",
      })
    }
    if (server.status.status === "disabled") {
      throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is disabled`, next: `Enable ${name} in /mcps, or remove its disabled setting.` })
    }
    if (server.status.status !== "connected") {
      throw new SourceError({ code: "UNAVAILABLE", what: `the ${name} MCP server is still connecting`, next: "Call again in a few seconds." })
    }
    tool ??= (await host.tools()).find((entry) => entry.id === `${name}_search_meetings`)
    if (tool === undefined) {
      throw new SourceError({
        code: "UNAVAILABLE",
        what: `the ${name} MCP server lists no search_meetings`,
        next: "A policy or an account setting may turn the server's tools off; check the plugin's status.",
      })
    }
    try {
      const result = await tool.execute(input, {
        sessionID: call.sessionID,
        agent: call.agent,
        messageID: call.messageID,
        id: call.id,
        signal: call.signal,
        progress: call.progress,
      })
      return resultData(result as { readonly output?: unknown; readonly content?: unknown })
    } catch (error) {
      if (call.signal.aborted || error instanceof SourceError) throw error
      const line = redactReason(reasonOf(error).split(/\r?\n/, 1)[0] ?? "no reason given")
      throw new SourceError({
        code: "UNAVAILABLE",
        what: `search_meetings failed: ${line}`,
        next: "Call again with the same cursor; if it keeps failing, read the plugin's status.",
      })
    }
  }
}

/**
 * The provider for `plugin`, whose id binds every cursor, and `packageName`, which every page names. `host` is the
 * public API the plugin runs against.
 */
export function createProvider(options: { readonly plugin: string; readonly packageName: string; readonly host: Host }): Provider {
  const nameOf = (account: string) => accountName(options.plugin, account)

  return {
    async owner({ account }) {
      return ownerFor(options.host, nameOf(account))
    },

    async page({ account, input, now, call }) {
      const owner = await ownerFor(options.host, nameOf(account))
      return listEvents(searcherFor(options.host, nameOf(account), call), owner, account, options.packageName, input, now)
    },

    async list({ account, input, now, call }) {
      await ownerFor(options.host, nameOf(account))
      return meetingsList(searcherFor(options.host, nameOf(account), call), account, input, now)
    },

    async probe({ account }) {
      return probeResult({ source: SOURCE, account, owner: await ownerFor(options.host, nameOf(account)) })
    },

    async signal({ account }) {
      const name = nameOf(account)
      try {
        return { state: "ready", owner: await ownerFor(options.host, name) }
      } catch (error) {
        if (error instanceof SourceError && error.code === "NEEDS_SIGN_IN") return { state: "needs_sign_in" }
        return { state: "error", reason: redactReason(reasonOf(error)) }
      }
    },
  }
}
