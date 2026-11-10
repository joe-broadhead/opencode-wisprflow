// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /wisprflow-status, H6 unload, and the /connect entry. Each describe owns
// one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import * as z from "zod"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { READ, WRITE } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /wisprflow-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Wispr Flow tools."
const NEW = "shiny_new_tool"
const SIGN_IN = "Run /connect and choose Wispr Flow, then press o or Enter to open the link (in a terminal, opencode mcp auth wisprflow opens it automatically)."
/** The fake's tools: one known read, a known write when Wispr Flow has one, and one tool the plugin has never seen. */
const SERVED = [READ, ...(WRITE ? [WRITE] : []), NEW].map((tool) => `wisprflow_${tool}`).sort()

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

test("the forced Wispr Flow catalogue stays under 1,000 tokens", async () => {
  let captured = ""
  const mock = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const body = await request.json() as { messages?: { role: string; content?: unknown }[] }
    const system = (body.messages ?? []).filter(item => item.role === "system").map(item => typeof item.content === "string" ? item.content : "").join("\n")
    if (system.includes("- wisprflow (")) captured = system
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(`${chunk({ role: "assistant", content: "ok" })}${chunk({}, "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  let target: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    target = await startHost({ config: () => ({ providers: { scripted: { name: "Scripted", package: ["@opencode", "ai", "providers", "openai-compatible"].join("/"), settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "test" }, models: { m1: { name: "Mock", capabilities: { tools: true } } } } }, model: "scripted/m1" }) })
    await until("the Wispr Flow tools to register", async () => (await target!.probe().tool.list()).some(tool => tool.id === "wisprflow_search_meetings"))
    const filler = await target.probe().tool.transform(editor => {
      editor.namespace({ name: "filler", description: "Spends the inline budget." })
      editor.add({ name: "pad", description: "pad", input: z.object({ note: z.string().describe("x".repeat(9000)) }), options: { namespace: "filler", permission: "filler_pad", pinned: true }, execute: async () => ({ content: "ok" }) } as never)
    })
    try {
      const session = await target.client.session.create({ location: target.location, agent: "build" } as never)
      await target.client.session.prompt({ sessionID: session.id, text: "Reply with ok." } as never)
      await until("the catalogue", async () => captured.includes("- wisprflow ("))
      const lines = captured.split("\n"), start = lines.findIndex(line => line.startsWith("- wisprflow (")), section = [lines[start]!]
      for (let i = start + 1; i < lines.length && lines[i]!.startsWith("  "); i++) section.push(lines[i]!)
      expect(Math.round(section.join("\n").length / 4)).toBeLessThanOrEqual(1000)
    } finally { await filler.dispose() }
  } finally { await target?.close(); mock.stop(true) }
}, 120_000)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `wisprflow_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `wisprflow_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/** The host lists an MCP server's tools shortly after it connects. */
const wisprflowTools = (host: Host) =>
  until("Wispr Flow's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("wisprflow_"))
    return ids.length === SERVED.length && ids.sort()
  })

/**
 * Runs `code` as Code Mode does, through a schedule's check program: OpenCode checks each tool's input and output and
 * evaluates permissions with nobody present to answer a prompt. The program reports by throwing "SEEN <json>", so no
 * schedule is ever created and no model is involved.
 */
async function codeMode(host: Host, sessionID: string, code: string): Promise<{ seen: unknown } | { refused: string }> {
  let message: string
  try {
    const schedule = await host.client.experimental.schedule.create({
      sessionID,
      name: "wisprflow-host-test",
      when: { in: "6 hours" },
      prompt: "noop",
      if: { code },
    })
    await host.client.experimental.schedule.delete({ scheduleID: schedule.id })
    throw new Error("the check program finished without reporting")
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  const seen = /SEEN (.*)$/s.exec(message)
  if (!seen) return { refused: message }
  try {
    return { seen: JSON.parse(seen[1]!) }
  } catch {
    return { seen: seen[1]! }
  }
}

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "wisprflow-status", text: "" })
  return until("/wisprflow-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

describe(`the plugin's own server on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, wisprflow is connected, and its tools, skills and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "wisprflow.meetings")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "wisprflow")?.status).toEqual({ status: "connected" })
    expect(await wisprflowTools(host)).toEqual(SERVED)
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("wisprflow")).sort()).toEqual([...SKILL_NAMES].sort())
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("wisprflow-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "wisprflow_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", `wisprflow_${READ}`)).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", READ)).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: wisprflow_${READ}` })
  })

  // R18: every tool is allowed by default, a tool Wispr Flow adds later included, so nothing asks here.
  test("H2: every tool runs without a prompt, the plugin's own reads and one it does not know", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", READ)).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", NEW)).toEqual({ asked: undefined, ok: true })
    if (WRITE) expect(await attempt(host, build, "build", WRITE)).toEqual({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual([READ, NEW, ...(WRITE ? [WRITE] : [])])
    const build_ = (await agentRules(host)).get("build")!
    expect(SERVED.filter((action) => hidden(build_, action))).toEqual([])
    expect(await effect(host, "build", `wisprflow_${NEW}`)).toBe("allow")
  })

  test("P5: an agent defined only in user config gets no rules, and Wispr Flow tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("wisprflow_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", NEW)).toEqual({ asked: undefined, ok: true })
  })

  // R2: the same proofs on the Code Mode path, inside the host's `execute`, where nobody can answer a prompt.
  test("R2 Code Mode: a read runs; an ask and a deny are refused with nothing sent; an unknown name is refused", async () => {
    await wisprflowTools(host)
    const run = async (sessionID: string, tool: string) =>
      codeMode(host, sessionID, `const r = await tools.wisprflow[${JSON.stringify(tool)}]({}); throw new Error("SEEN " + JSON.stringify(r))`)
    const created = async (permissions?: Rule[]) => (await host.client.sessions.create({ agent: "build", location: host.location, ...(permissions ? { permissions } : {}) })).id

    // A known read runs inside Code Mode, and Wispr Flow is called once.
    const before = host.fake.calls.length
    expect(await run(await created(), READ)).toHaveProperty("seen")
    expect(host.fake.calls.slice(before)).toEqual([READ])

    // An ask is refused before the tool runs: nothing reaches Wispr Flow and no prompt is left waiting.
    const asking = host.fake.calls.length
    const askSession = await created([{ action: `wisprflow_${READ}`, resource: "*", effect: "ask" }])
    const asked = await run(askSession, READ)
    expect(asked).toHaveProperty("refused")
    expect((asked as { refused: string }).refused).toMatch(/needs approval|nobody is present|not permitted|declined/i)
    expect(host.fake.calls.slice(asking)).toEqual([])
    expect(await host.client.permission.list({ sessionID: askSession })).toEqual([])

    // A deny refuses, and a name that is not a method is not callable.
    const denied = await run(await created([{ action: `wisprflow_${READ}`, resource: "*", effect: "deny" }]), READ)
    expect(denied).toHaveProperty("refused")
    const unknown = await run(await created(), "no_such_tool")
    expect(unknown).toHaveProperty("refused")
    expect(host.fake.calls.slice(asking)).toEqual([])
  })

  test("H5: /wisprflow-status reports the connection, the plugin's own skills, new tools, the unguarded agent and its fix", async () => {
    await wisprflowTools(host)
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    // The skills OpenCode lists are the plugin's own files, so none is reported as replaced.
    expect(text).toContain("- Skills: the plugin's own\n")
    expect(text).toContain(`- Tools: ${SERVED.length} available, 1 unknown: ${NEW} (new tools run too)\n`)
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "wisprflow.meetings", setup: () => {} }))
    await until("the wisprflow server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "wisprflow")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("wisprflow_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("wisprflow-status")
  })
})

describe(`access on OpenCode ${HOST_VERSION}`, () => {
  // R18: one host test per value, on the tools RPC path, where a refusal must reach nothing.
  const call = async (host: Host, sessionID: string, method: string, input: unknown = {}): Promise<{ value?: unknown; refused?: string }> =>
    host.client.rpc
      .call({ rpcID: "wisprflow.meetings.tools", method, input: { sessionID, input } as never, location: host.location })
      .then((result) => ({ value: result.output }))
      .catch((error: unknown) => ({ refused: (error as { data?: { code?: string }; message?: string }).data?.code ?? String(error) }))

  for (const [access, expectation] of [
    ["ask-changes", "refuse"],
    ["read-only", "deny"],
  ] as const) {
    describe(access, () => {
      let host: Host
      beforeAll(async () => {
        host = await startHost({ options: { access } })
        await wisprflowTools(host)
      })
      afterAll(() => host?.close())

      test(`the block is the ${access} one, and a read still runs on the tools RPC path`, async () => {
        const rules = (await agentRules(host)).get("build")!
        expect(rules.slice(1, 1 + defaultRules(access).length)).toEqual(defaultRules(access))
        const before = host.fake.calls.length
        const sessionID = await session(host)
        expect(await call(host, sessionID, READ)).toHaveProperty("value")
        expect(host.fake.calls.slice(before)).toEqual([READ])
      })

      test(`${expectation === "deny" ? "a denied" : "an asking"} tool never reaches Wispr Flow, and an unknown name is not a method`, async () => {
        const before = host.fake.calls.length
        // Every known Wispr Flow tool only reads, so the refused call is a read with a session rule of its own: the
        // same shape as a write under this access value, with nothing sent and no prompt left waiting.
        const sessionID = (
          await host.client.sessions.create({
            agent: "build",
            location: host.location,
            permissions: [{ action: `wisprflow_${READ}`, resource: "*", effect: expectation === "deny" ? "deny" : "ask" }],
          })
        ).id
        expect(await call(host, sessionID, READ)).toMatchObject({ refused: "PERMISSION_DENIED" })
        expect((await call(host, await session(host), NEW)).refused ?? "").toContain("Unknown RPC method")
        expect(host.fake.calls.slice(before)).toEqual([])
        expect(await host.client.permission.list({ sessionID })).toEqual([])
      })
    })
  }
})

describe("the user's own wisprflow server at the plugin's URL", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { wisprflow: { type: "remote", url, oauth: false, headers: { "x-wisprflow-test": "user" } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: is adopted unchanged, and its reads run", async () => {
    expect(await attempt(host, await session(host), "build", READ)).toEqual({ asked: undefined, ok: true })
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, your own mcp.servers.wisprflow, used unchanged)`)
    expect(text).toContain("- Access: every tool runs without asking")
  })
})

describe("user permissions", () => {
  const userRules = [allow(NEW), deny(READ)]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a tool that asks removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", NEW)).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", READ)).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: wisprflow_${READ}` })
    expect(hidden((await agentRules(host)).get("build")!, `wisprflow_${READ}`)).toBe(true)
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", NEW)).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", READ)).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

describe("a user wisprflow server with a trailing slash", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { wisprflow: { type: "remote", url: `${url}/`, oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict that names the slash", async () => {
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: conflict (your mcp.servers.wisprflow points at ${host.fake.url}/)`)
    expect(text).toContain(`- Next step: mcp.servers.wisprflow is set to ${host.fake.url}/; Wispr Flow's sign-in needs ${host.fake.url}, without the trailing slash.`)
  })
})

describe("a user wisprflow server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { wisprflow: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.wisprflow points at ${other})`)
    expect(text).toContain(`- Next step: mcp.servers.wisprflow is set to ${other}, but Wispr Flow's server is ${host.fake.url}.`)
  })
})

// Wispr Flow's server answers 401 with a bearer challenge until the user signs in. On the host's own MCP client that is
// a sign-in, not a failure: status and the status RPC say so, with the /connect step.
describe("a server that asks for a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, fake: { challenge: true } })
  })
  afterAll(() => host?.close())

  test("is sign-in required, with the /connect next step, in the RPC and in /wisprflow-status", async () => {
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "wisprflow")
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(server.status.status).toBe("needs_auth")
    const { output } = (await host.client.rpc.call({ rpcID: "wisprflow.meetings", method: "status", input: {}, location: host.location })) as { output: Record<string, unknown> }
    expect(output).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(host.fake.markers.length).toBeGreaterThan(0)
  })
})

// The /connect mark is only observable while a credential remains, so this signs in with Wispr Flow's own flow and a
// token that has no refresh token: a 401 then needs a new sign-in rather than a refresh, and the account stays. The
// plugin reads its mark back from the projected connection, so the mark it sets is the one it clears.
describe("the /connect sign-in mark", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, fake: { challenge: true, refreshTokens: false } })
  })
  afterAll(() => host?.close())

  const SIGN_IN_AGAIN = "Wispr Flow needs a new sign-in. Choose this account to sign in again."

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "wisprflow")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { type?: string; status?: { status: string; message?: string } }[] }).connections ?? []
  }

  /** Signs in through OpenCode's own flow: the authorization endpoint redirects the loopback callback, which exchanges its code. */
  const signIn = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "wisprflow")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const callback = redirect.headers.get("location")
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    await fetch(callback!)
  }
  const connected = () =>
    until("the server is connected", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "wisprflow")?.status.status === "connected"
    })

  test("is set while the server needs a sign-in, and cleared once the same account connects again", async () => {
    await signIn()
    await until("the sign-in stores a token without a refresh token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    host.fake.challenge = false
    await connected()
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.type === "credential" && item.status?.message === undefined))).toBeDefined()

    // The token stops working, and there is no refresh token: a new sign-in, with the credential kept.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "wisprflow", location: host.location })
    await mcp.connect({ server: "wisprflow", location: host.location }).catch(() => {})
    await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "wisprflow")?.status.status === "needs_auth"
    })
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_AGAIN))).toBeDefined()

    // The same account connects again: the plugin clears its own mark.
    host.fake.challenge = false
    await mcp.connect({ server: "wisprflow", location: host.location })
    await connected()
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "wisprflow")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("is named Wispr Flow, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named Wispr Flow", async () => ((await entry())?.name === "Wispr Flow" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named Wispr Flow again after the reload", async () => (await entry())?.name === "Wispr Flow")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("Wispr Flow")
  })

  test("events_list is a tools RPC method beside the known reads, run as the session, with its own codes", async () => {
    const build = await session(host)
    const call = async (method: string, input: unknown) => {
      try {
        return { value: (await host.client.rpc.call({ rpcID: "wisprflow.meetings.tools", method, input: input as never, location: host.location })).output as Record<string, any> }
      } catch (error) {
        const e = error as { type?: string; data?: { code?: string } }
        return { type: e.type, code: e.data?.code }
      }
    }
    const described = await call("describe", {})
    expect(described.value?.methods.at(-1)).toMatchObject({ name: "events_list", kind: "plugin", action: "wisprflow_events_list" })
    // This host signs in to the fake with no credential, so there is no sign-in to name as the owner.
    const before = host.fake.calls.length
    expect(await call("events_list", { sessionID: build, input: { since: "2026-10-01" } })).toEqual({ type: "failed", code: "EVENTS_OWNER_UNKNOWN" })
    expect(await call("events_list", { sessionID: build, input: { cursor: "not-a-cursor" } })).toEqual({ type: "failed", code: "EVENTS_CURSOR_INVALID" })
    expect(host.fake.calls.slice(before)).toEqual([])
  })
})
