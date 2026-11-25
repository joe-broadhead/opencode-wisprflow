// The shipped bundle in the real embedded OpenCode 2.4.1 host: every `skills/<name>/SKILL.md` the package ships is
// registered after the plugin loads, and the doors the last pre-4b release gave a user are still there (the plugin tools,
// the default access rules on every built-in agent, and the status method over RPC). Run by `npm run test:host`.
import { ROOT } from "./isolate.ts"
import assert from "node:assert/strict"
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { after, before, describe, test } from "node:test"
import { parse } from "yaml"
import { OpenCode } from "@opencode/sdk"
import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin"
import { rulesFor } from "@we-the-rebel-alliance/plugin-contract/access"
import { manifest } from "../../src/manifest.ts"

/** The SDK's own `Interface` resolves to `any` through its self-referential namespace, so name what this test calls. */
type Client = Omit<OpenCodeClient, "plugin"> & {
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
}

const root = fileURLToPath(new URL("../..", import.meta.url))
const VERSION = "2.4.1"
/** A busy machine may take a while to start the host; each test is bounded below. */
const READY_TIMEOUT_MS = 120_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The skills the package ships, read from the files rather than from the plugin's own loader. */
function expectedSkills(): { name: string; description: string }[] {
  const directory = join(root, "skills")
  const found = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.ok(found.length > 0, "the package ships at least one skills/<name>/SKILL.md")
  return found.map((name) => {
    const text = readFileSync(join(directory, name, "SKILL.md"), "utf8")
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1]
    assert.ok(front !== undefined, `skills/${name}/SKILL.md has front matter`)
    const fields = parse(front) as { name?: unknown; description?: unknown }
    assert.equal(fields.name, name, `skills/${name}/SKILL.md names itself ${name}`)
    assert.equal(typeof fields.description, "string", `skills/${name}/SKILL.md has a description`)
    const description = (fields.description as string).trim()
    assert.notEqual(description, "", `skills/${name}/SKILL.md has a non-empty description`)
    assert.doesNotMatch(description, /^[>|][+-]?\d*$/, `skills/${name}/SKILL.md has a real description, not a block marker`)
    return { name, description }
  })
}

async function until<T>(what: string, check: () => Promise<T | undefined | false>, timeoutMs = READY_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  for (;;) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      last = error
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting until ${what}${last === undefined ? "" : `: ${last instanceof Error ? last.message : String(last)}`}`)
    }
    await sleep(25)
  }
}

/** The status answer, as the contract's §11 shape carries it. */
interface StatusAnswer {
  readonly name: string
  readonly version: string
  readonly host: { readonly version: string; readonly range: string; readonly tested: readonly string[] }
  readonly state: string
  readonly accounts: readonly { readonly alias: string; readonly state: string }[]
  readonly unguardedAgents: readonly string[]
}

const holds = (rules: readonly { action: string; resource: string; effect: string }[], rule: { action: string; resource: string; effect: string }) =>
  rules.some((held) => held.action === rule.action && held.resource === rule.resource && held.effect === rule.effect)

after(() => rmSync(ROOT, { recursive: true, force: true }))

describe("the built bundle in the embedded OpenCode 2.4.1 host", () => {
  const work = join(ROOT, "work")
  const location = { directory: work }
  // A second, real plugin lends its setup context: the tests read the host's own tool list, which the client does not expose.
  const probes = new Map<string, Plugin.Context>()
  let client: Client

  before(
    async () => {
      mkdirSync(work, { recursive: true })
      // The project is an empty temp directory, never the repository: OpenCode discovers <project>/skills/ by itself,
      // so a repo-root project would pass this test even with the plugin's registration removed.
      assert.deepEqual(readdirSync(work), [], "the project directory is empty")
      assert.equal(existsSync(join(work, "skills")), false, "the project has no skills/ to discover")
      assert.equal(existsSync(join(ROOT, "skills")), false, "the temp git root has no skills/ either")
      const shipped = (await import(pathToFileURL(join(root, "dist", "index.js")).href)) as { default: Plugin.Plugin }
      assert.equal(shipped.default.id, "wisprflow", "the bundle exports the plugin")
      const probe = Plugin.define({ id: "wisprflow.host-test.probe", setup: (ctx) => void probes.set(ctx.location.directory, ctx) })
      client = await OpenCode.create({
        plugins: [shipped.default, probe],
        // An embedded host reports "unknown" unless told, and the plugin's host guard refuses that.
        app: { version: VERSION },
        config: {
          content: JSON.stringify({
            // Keep the built-in local providers from probing their default ports.
            providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
          }),
          directory: join(ROOT, "config"),
          project: false,
          claude: false,
        },
        database: { path: join(ROOT, "opencode.db") },
        models: { fetch: false },
        fs: { filewatcher: false },
        // The vendor's MCP server needs a sign-in this test does not have; the request is refused here, so none leaves.
        fetch: (input: Request | string | URL, init?: RequestInit) => {
          const url = new URL(input instanceof Request ? input.url : input)
          if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return globalThis.fetch(input, init)
          return Promise.reject(new Error(`the host test blocked a fetch to ${url.origin}`))
        },
        log: { level: "error", emit: () => {} },
      })
      // Plugins load in the background: wait, with a bound, for this one to be active before reading its skills.
      await until("the Wispr Flow plugin is active", async () => {
        const { data } = await client.plugin.list({ location })
        const entry = data.find((plugin) => plugin.id === "wisprflow")
        if (entry?.state?.status === "failed") throw new Error(`the Wispr Flow plugin failed: ${entry.state.error}`)
        return entry?.state?.status === "active"
      })
      await until("the probe plugin has loaded", async () => probes.get(work))
    },
    { timeout: 180_000 },
  )

  after(async () => {
    await client?.close().catch(() => undefined)
    rmSync(ROOT, { recursive: true, force: true })
  })

  test("every shipped skill is registered", { timeout: 30_000 }, async () => {
    const expected = expectedSkills()
    const { data } = await client.skill.list({ location })
    const listed = new Map(data.map((skill) => [skill.id, skill]))
    for (const expectedSkill of expected) {
      const { name, description } = expectedSkill
      const skill = listed.get(name)
      assert.ok(skill, `skills/${name}/SKILL.md is registered as ${name}; the host lists ${[...listed.keys()].join(", ") || "nothing"}`)
      assert.equal(skill.name, name)
      assert.equal(skill.description, description, `${name} keeps the description its SKILL.md declares`)
      assert.notEqual(skill.description.trim(), "", `${name} has a non-empty description`)
      assert.doesNotMatch(skill.description, /^[>|][+-]?\d*$/, `${name} has a real description, not a block marker`)
      assert.ok(skill.content.length > 0, `${name} keeps its content`)
      assert.ok(skill.path.endsWith(`/skills/${name}/SKILL.md`), `${name} keeps its file, not another skill's: ${skill.path}`)
    }
    const expectedNames = expected.map((skill) => skill.name)
    assert.deepEqual([...listed.keys()].filter((id) => expectedNames.includes(id)).sort(), expectedNames)
  })

  test("the plugin tools and the default access rules are on every built-in agent", { timeout: 30_000 }, async () => {
    const context = probes.get(work)
    assert.ok(context, "the probe plugin's context")
    const tools = (await context.tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("wisprflow_"))
    assert.deepEqual(tools.sort(), ["wisprflow_events_list", "wisprflow_probe", "wisprflow_status"], "events_list, probe and status are tools again")

    // The same seven built-in agents the last pre-4b release guarded.
    const agents = (await client.agent.list({ location })).data
    const base = (permissions: readonly { action: string; resource: string; effect: string }[]) =>
      permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
    const guarded = agents.filter((agent) => base(agent.permissions))
    assert.deepEqual(
      guarded.map((agent) => agent.id).sort(),
      ["build", "compaction", "explore", "general", "plan", "summary", "title"],
    )
    const generated = rulesFor(manifest, "all", ["default"])
    assert.equal(generated.length, 19, "three methods and sixteen pass-through MCP tools")
    for (const agent of guarded) {
      for (const rule of generated) assert.ok(holds(agent.permissions, rule), `${agent.id} holds ${rule.action} ${rule.effect}`)
      // The two contact reads ask at every level, a deliberate narrowing of v0.0.8's blanket allow.
      for (const tool of ["get_participant_contacts", "get_meeting_participants_enriched"]) {
        assert.ok(holds(agent.permissions, { action: `wisprflow_${tool}`, resource: "*", effect: "ask" }), `${agent.id} asks before ${tool}`)
      }
    }
  })

  test("the status method answers over the contract's one RPC id", { timeout: 30_000 }, async () => {
    const session = await client.session.create({ location, agent: "build" })
    const answer = await client.rpc.call({ rpcID: "wisprflow", method: "status", input: { sessionID: session.id, input: {} }, location })
    const status = answer.output as StatusAnswer
    assert.ok(status, "status answers")
    assert.equal(status.name, "wisprflow")
    assert.equal(status.version, "0.0.0")
    assert.deepEqual(status.host, { version: VERSION, range: ">=2.4.1 <2.5.0", tested: [VERSION] })
    assert.deepEqual(
      status.accounts.map((account) => account.alias),
      ["default"],
    )
    assert.deepEqual(status.unguardedAgents, [])
  })
})
