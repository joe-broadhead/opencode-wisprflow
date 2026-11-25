/** The handlers, driven through their real entry, against a synthetic MCP host and a fixed clock. */
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest as installed, packageName, version } from "../../src/manifest.ts"
import { handlersFor, type HandlerRuntime } from "../../src/handlers/index.ts"
import { createProvider, type ConnectionInfo, type Host, type ServerInfo, type ServerStatus, type ToolInfo } from "../../src/provider/client.ts"
import { MEETINGS, NOW, PERSONAL, wisprflow, type Meeting } from "./fake.ts"

/** The options the fixture and the T1 host use: two aliases. */
export const OPTIONS = { accounts: { work: {}, personal: {} } } as const

export interface HostOptions {
  /** The aliases whose sign-in OpenCode holds; the others answer `needs_auth`. */
  readonly signedIn?: readonly string[]
  /** A server's state by alias; it overrides `signedIn`. */
  readonly status?: Readonly<Record<string, ServerStatus>>
  /** Each alias's meetings; the default is the work fixture and one personal meeting. */
  readonly meetings?: Readonly<Record<string, readonly Meeting[]>>
  readonly pageSize?: number
  /** An alias whose `search_meetings` throws this message, as the vendor's tool can. */
  readonly fail?: Readonly<Record<string, string>>
}

export interface FakeHost {
  readonly host: Host
  /** Every `search_meetings` call, in order, with the alias whose server answered it. */
  readonly calls: { readonly alias: string; readonly input: Record<string, unknown> }[]
}

/** A host with one MCP server per alias, a sign-in per signed-in alias, and the vendor's `search_meetings` tool. */
export function fakeHost(options: HostOptions = {}): FakeHost {
  const aliases = Object.keys(OPTIONS.accounts)
  const signedIn = options.signedIn ?? aliases
  const meetings: Readonly<Record<string, readonly Meeting[]>> = options.meetings ?? { work: MEETINGS, personal: PERSONAL }
  const calls: { alias: string; input: Record<string, unknown> }[] = []
  const serverName = (alias: string) => (alias === "default" ? "wisprflow" : `wisprflow-${alias}`)

  const servers = (): ServerInfo[] =>
    aliases.map((alias) => {
      const status = options.status?.[alias] ?? (signedIn.includes(alias) ? { status: "connected" as const } : { status: "needs_auth" as const })
      return { name: serverName(alias), status, integrationID: `int-${serverName(alias)}` }
    })

  const tools = (): ToolInfo[] =>
    aliases.flatMap((alias) => {
      const state = options.status?.[alias]?.status ?? (signedIn.includes(alias) ? "connected" : "needs_auth")
      if (state !== "connected") return []
      const search = wisprflow(options.pageSize ?? 2, meetings[alias] ?? [])
      return [
        {
          id: `${serverName(alias)}_search_meetings`,
          async execute(input: unknown) {
            const value = (input ?? {}) as Record<string, unknown>
            calls.push({ alias, input: value })
            const failure = options.fail?.[alias]
            if (failure !== undefined) throw new Error(failure)
            return { output: await search.search(value) }
          },
        },
      ]
    })

  const host: Host = {
    tools: async () => tools(),
    servers: async () => servers(),
    activeConnection: async (integrationID: string): Promise<ConnectionInfo | undefined> => {
      const alias = aliases.find((candidate) => integrationID === `int-${serverName(candidate)}`)
      if (alias === undefined || !signedIn.includes(alias)) return undefined
      return { type: "credential", id: `cred-${alias}`, label: `Wispr Flow (${alias})` }
    },
  }
  return { host, calls }
}

/** A runtime with the real manifest, the given host and a fixed clock. */
export function runtimeFor(host: FakeHost = fakeHost(), overrides: Partial<HandlerRuntime> = {}): HandlerRuntime {
  const plan = accountsOf(installed, OPTIONS)
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  return {
    plugin: installed.plugin.name,
    packageName,
    manifest: installed,
    version,
    hostVersion: "2.4.1",
    accounts: plan.value.accounts,
    accountProblems: [],
    provider: createProvider({ plugin: installed.plugin.name, packageName, host: host.host }),
    clock: () => NOW,
    ...overrides,
  }
}

/** The call context a handler sees, as `register` builds it. */
function callFor(account: string, unguardedAgents: () => Promise<UnguardedAgentsResult> = async () => ({ ok: true, agents: [] })): MethodCall {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => undefined,
    account,
    unguardedAgents,
  } as unknown as MethodCall
}

/** Run one handler with an account and the input `register` would pass. */
export async function run(
  runtime: HandlerRuntime,
  method: "status" | "probe" | "events_list",
  input: Readonly<Record<string, unknown>>,
  account = "work",
  unguardedAgents?: () => Promise<UnguardedAgentsResult>,
): Promise<unknown> {
  const handler = handlersFor(runtime)[method]
  if (handler === undefined) throw new Error(`no handler for ${method}`)
  return handler.run(input, callFor(account, unguardedAgents))
}
