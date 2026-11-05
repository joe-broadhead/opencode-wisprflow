// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /wisprflow-status, H6 unload, and the /connect entry. Each describe owns
// one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
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
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", NEW)).toMatchObject({ asked: `wisprflow_${NEW}`, ok: false })
  })

  test("P2 and H2: known reads run without a prompt, and a tool the plugin doesn't know asks", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", READ)).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", NEW)).toEqual({ asked: `wisprflow_${NEW}`, ok: false, error: "Permission.DeclinedError: " })
    if (WRITE) expect(await attempt(host, build, "build", WRITE)).toEqual({ asked: `wisprflow_${WRITE}`, ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls.slice(before)).toEqual([READ])
    const build_ = (await agentRules(host)).get("build")!
    expect(SERVED.filter((action) => hidden(build_, action))).toEqual([])
    expect(await effect(host, "build", `wisprflow_${NEW}`)).toBe("ask")
  })

  test("P4: a saved 'Always allow' removes the prompt", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", NEW, "always")).toEqual({ asked: `wisprflow_${NEW}`, ok: true })
    expect(await attempt(host, build, "build", NEW)).toEqual({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: build })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: `wisprflow_${NEW}`, resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and Wispr Flow tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("wisprflow_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", NEW)).toEqual({ asked: undefined, ok: true })
  })

  test("H5: /wisprflow-status reports the connection, the plugin's own skills, new tools, the unguarded agent and its fix", async () => {
    await wisprflowTools(host)
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    // The skills OpenCode lists are the plugin's own files, so none is reported as replaced.
    expect(text).toContain("- Skills: the plugin's own\n")
    expect(text).toContain(`- Tools: ${SERVED.length} available, 1 unknown: ${NEW} (unknown tools ask before running)\n`)
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
    expect(text).toContain("- Access: reads run without asking;")
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
})
