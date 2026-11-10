import { describe, expect, test } from "bun:test"
import { ENDPOINT } from "../../src/constants.js"
import { checkHost } from "../../src/host-version.js"
import { defaultRules } from "../../src/permissions.js"
import { shortReason } from "../../src/redact.js"
import { buildStatus, formatStatus, readStatus, registerStatusCommand, registerStatusRpc, StatusRpc, type Status, type StatusContext, type StatusFacts } from "../../src/status.js"
import { VERSION } from "../../src/version.js"
import { PERSONAL_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { allow } from "./fake.js"

const SIGN_IN = "Run /connect and choose Wispr Flow, then press o or Enter to open the link (in a terminal, opencode mcp auth wisprflow opens it automatically)."
const NOTHING_TO_DO = "Nothing to do."
const ACCESS = "every tool runs without asking, reads and new tools included"
/** The default rules as /wisprflow-status shows them: one rule a line, a JSON array body. */
const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")

const host = checkHost("2.2.3", false)
const READ = READ_TOOLS[0]!
const base: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: ENDPOINT }, host, tools: [READ] }
const guarded = { id: "build", permissions: [allow("*"), ...defaultRules()] }
const own = [
  { name: "wisprflow", path: "/projects/plugin/skills/wisprflow/SKILL.md" },
  { name: "wisprflow-meeting-brief", path: "/projects/plugin/skills/wisprflow-meeting-brief/SKILL.md" },
]

describe("buildStatus", () => {
  test("connected, with nothing left to do", () => {
    const status = buildStatus({ ...base, account: "Acme", agents: [guarded] })
    expect(status).toEqual({
      version: VERSION,
      state: "connected",
      account: "Acme",
      access: "all",
      source: { type: "plugin", url: ENDPOINT },
      tools: 1,
      unknownCount: 0,
      unknownTools: [],
      unguardedAgents: [],
      shadowedSkills: [],
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      problems: [],
      nextStep: "Nothing to do.",
    })
    expect(formatStatus(status)).toBe(
      [
        "Wispr Flow status",
        "- Connection: connected (https://api.wisprflow.ai/connect/mcp, registered by this plugin)",
        "- Account: Acme",
        `- Access: ${ACCESS}`,
        "- Skills: the plugin's own",
        "- Tools: 1 available, 0 unknown",
        "- Agents without default rules: none",
        "- OpenCode: 2.2.3 (tested; supported range >=2.2.3 <2.3.0)",
        "- Next step: Nothing to do.",
      ].join("\n"),
    )
  })

  test.each([
    [{ status: "needs_auth", error: "Authorization required" }, "sign_in_required", "sign-in required", SIGN_IN],
    [{ status: "failed", error: "fetch failed" }, "failed", "failed", "Check your network, then run /wisprflow-status again."],
    [{ status: "disabled" }, "disabled", "disabled", `The wisprflow MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.wisprflow in opencode.json.`],
    [{ status: "pending" }, "connecting", "connecting", "Wispr Flow is still connecting. Run /wisprflow-status again in a few seconds."],
    [undefined, "not_configured", "not configured", "OpenCode has no wisprflow MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode."],
  ] as const)("%j is %s with the exact label and next step", (server, state, label, nextStep) => {
    const status = buildStatus({ ...base, ...(server ? { server } : { server: undefined }) })
    expect(status.state).toBe(state)
    expect(status.nextStep).toBe(nextStep)
    expect(formatStatus(status)).toContain(`- Connection: ${label}`)
    expect(formatStatus(status)).toContain(`- Next step: ${nextStep}`)
  })

  test("connected with no tools: Wispr Flow turned its MCP off for this account, and the next step says where to look", () => {
    const status = buildStatus({ ...base, tools: [], agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(
      "Wispr Flow lists no tools for this account. An active HIPAA agreement or an organisation policy turns its MCP off: check Wispr Flow's Settings → MCP or ask your admin, then run /wisprflow-status again.",
    )
    expect(formatStatus(status)).toContain("- Tools: 0 available: Wispr Flow lists no tools for this account\n")
    // Before the connection is up, no tools is normal, and the connection's own step comes first.
    const signIn = buildStatus({ ...base, tools: [], server: { status: "needs_auth" } })
    expect(signIn.nextStep).toBe(SIGN_IN)
    expect(formatStatus(signIn)).toContain("- Tools: 0 available, 0 unknown\n")
  })

  test("shows a failure's reason on one short line, without URL queries, and never the text of a needed sign-in", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "SSE error:\n  fetch https://api.wisprflow.ai/connect/mcp?token=secret-123 failed.\n" } })
    expect(failed.error).toBe("SSE error: fetch https://api.wisprflow.ai/connect/mcp failed")
    expect(formatStatus(failed)).toContain(`- Connection: failed (SSE error: fetch https://api.wisprflow.ai/connect/mcp failed; ${ENDPOINT}, registered by this plugin)`)
    expect(shortReason("word ".repeat(80))).toHaveLength(160)
    expect(shortReason(" \n. ")).toBeUndefined()
    const signIn = buildStatus({ ...base, server: { status: "needs_auth", error: "Visit https://mcp-auth.example.com/authorize?code=abc to sign in" } })
    expect(signIn.error).toBeUndefined()
    expect(formatStatus(signIn)).not.toContain("authorize")
  })

  test("names the account as unreported when OpenCode's credential has no label", () => {
    expect(formatStatus(buildStatus(base))).toContain("- Account: account name not reported by Wispr Flow's MCP")
  })

  test("adopted and conflicting servers, with the trailing slash named", () => {
    expect(formatStatus(buildStatus({ ...base, source: { type: "adopted", url: ENDPOINT } }))).toContain(`- Connection: connected (${ENDPOINT}, your own mcp.servers.wisprflow, used unchanged)`)
    const other = buildStatus({ ...base, source: { type: "conflict", url: "https://wispr.example.com/mcp", expected: ENDPOINT } })
    expect(other.state).toBe("conflict")
    expect(other.nextStep).toBe(
      `mcp.servers.wisprflow is set to https://wispr.example.com/mcp, but Wispr Flow's server is ${ENDPOINT}. Point it there or remove it, then restart OpenCode.`,
    )
    expect(formatStatus(other)).toContain("- Connection: conflict (your mcp.servers.wisprflow points at https://wispr.example.com/mcp)")
    const slash = buildStatus({ ...base, source: { type: "conflict", url: `${ENDPOINT}/`, expected: ENDPOINT } })
    expect(slash.nextStep).toBe(
      "mcp.servers.wisprflow is set to https://api.wisprflow.ai/connect/mcp/; Wispr Flow's sign-in needs https://api.wisprflow.ai/connect/mcp, without the trailing slash. Change it or remove it, then restart OpenCode.",
    )
    const local = buildStatus({ ...base, source: { type: "conflict", url: "a local command", expected: ENDPOINT } })
    expect(local.nextStep).toContain("mcp.servers.wisprflow is set to a local command, but Wispr Flow's server is")
  })

  test("counts the visible tools and names the unknown ones; known writes are not unknown", () => {
    const status = buildStatus({ ...base, tools: [READ, ...PERSONAL_TOOLS, ...WRITE_TOOLS, "shiny_new_tool", "get_dictation_history"] })
    expect(status.tools).toBe(3 + PERSONAL_TOOLS.length + WRITE_TOOLS.length)
    expect(status.unknownCount).toBe(2)
    expect(status.unknownTools).toEqual(["shiny_new_tool", "get_dictation_history"])
    expect(formatStatus(status)).toContain(`- Tools: ${3 + PERSONAL_TOOLS.length + WRITE_TOOLS.length} available, 2 unknown: shiny_new_tool, get_dictation_history (new tools run too)`)
  })

  test("names unknown tools in any case, and with dashes: the characters OpenCode keeps in a permission action", () => {
    const status = buildStatus({ ...base, tools: [READ, "createTask", "delete-note", "évil", "9lives"] })
    expect(status.unknownCount).toBe(4)
    expect(status.unknownTools).toEqual(["createTask", "delete-note"])
  })

  test("names at most 20 unknown tools, and only plain names, but counts them all", () => {
    const odd = ["Bad Name", "x".repeat(70), "evil\u001b[31m", "-dash"]
    const many = Array.from({ length: 25 }, (_, index) => `new_tool_${index}`)
    const status = buildStatus({ ...base, tools: [READ, ...odd, ...many] })
    expect(status.unknownCount).toBe(29)
    expect(status.unknownTools).toEqual(many.slice(0, 20))
    expect(formatStatus(status)).toContain(`- Tools: 30 available, 29 unknown: ${many.slice(0, 20).join(", ")} and 9 more (new tools run too)`)
    expect(formatStatus(buildStatus({ ...base, tools: odd }))).toContain("- Tools: 4 available, 4 unknown (new tools run too)")
  })

  test("names agents without the default rules, with the block to paste, and points the next step at it", () => {
    const status = buildStatus({ ...base, agents: [guarded, { id: "reviewer", permissions: [allow("*")] }] })
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.nextStep).toBe(
      "Put the default rules shown by /wisprflow-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Wispr Flow tools.",
    )
    // One rule a line, as a JSON array body that pastes into a permissions list.
    expect(JSON.parse(`[${AGENT_RULES}]`)).toEqual(defaultRules())
    const text = formatStatus(status)
    // The row lists the names only, then the rules.
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n- OpenCode:`)
    expect(text.indexOf("- Tools:")).toBeLessThan(text.indexOf("- Agents without"))
  })

  test("an agent whose own rules already ask or deny for every Wispr Flow tool, or that has no base allow, is not listed", () => {
    const agents = [
      { id: "asks-everything", permissions: [allow("*"), { action: "*", resource: "*", effect: "ask" as const }] },
      { id: "denies-wisprflow", permissions: [allow("*"), { action: "wisprflow_*", resource: "*", effect: "deny" as const }] },
      { id: "no-base", permissions: [allow("wisprflow_*")] },
      { id: "reviewer", permissions: [allow("*")] },
    ]
    expect(buildStatus({ ...base, agents }).unguardedAgents).toEqual(["reviewer"])
  })

  test("the sign-in step comes before the agent fix, which still shows, and there is one next step", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth", error: "x" }, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(SIGN_IN)
    const text = formatStatus(status)
    expect(text).toContain(`- Connection: sign-in required (${ENDPOINT}, registered by this plugin)`)
    expect(text).toContain("- Agents without default rules: reviewer\n")
    expect(text.match(/Next step/g)).toHaveLength(1)
  })

  test("at ask-changes the Access row lets the personal-data reads run, and says that new tools ask", () => {
    const row = formatStatus(buildStatus({ ...base, access: "ask-changes" })).split("\n").find((line) => line.startsWith("- Access:"))
    expect(row).toContain("- Access: reads run without asking, including the personal-data reads; new tools ask first")
    expect(row).not.toContain("get_participant_contacts")
  })

  test("the rows come in the standard order, with the Skills row between Access and Tools", () => {
    const rows = formatStatus(buildStatus(base)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(rows).toEqual(["Connection", "Account", "Access", "Skills", "Tools", "Agents without default rules", "OpenCode", "Next step"])
  })

  test("names a skill of the user's that takes the place of the plugin's, after the agent fix and setup problems", () => {
    const listed = [
      { id: "wisprflow", path: "/projects/user-config/opencode/skills/wisprflow/SKILL.md" },
      { id: "wisprflow-meeting-brief", path: own[1]!.path },
    ]
    const status = buildStatus({ ...base, skills: { own, listed } })
    expect(status.shadowedSkills).toEqual([{ name: "wisprflow", path: listed[0]!.path }])
    expect(status.nextStep).toBe(
      `Rename or move the skill at ${listed[0]!.path}, which uses the id of the plugin's wisprflow skill, so OpenCode loads the plugin's own.`,
    )
    expect(formatStatus(status)).toContain(`- Skills: wisprflow is replaced by ${listed[0]!.path}\n`)
    const both = buildStatus({ ...base, skills: { own, listed: [listed[0]!, { id: "wisprflow-meeting-brief", path: "/projects/x/SKILL.md" }] } })
    expect(both.nextStep).toBe(
      `Rename or move the skills at ${listed[0]!.path} and /projects/x/SKILL.md, which use the ids of the plugin's wisprflow and wisprflow-meeting-brief skills, so OpenCode loads the plugin's own.`,
    )
    expect(buildStatus({ ...base, skills: { own, listed }, agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toContain("Put the default rules")
    expect(buildStatus({ ...base, skills: { own, listed: own.map(({ name, path }) => ({ id: name, path })) } }).shadowedSkills).toEqual([])
  })

  test("a setup problem that explains the state gives the next step: a server not registered, and rules not added", () => {
    const server = "SERVER_NOT_REGISTERED: The wisprflow MCP server could not be registered (boom). Next step: Restart OpenCode."
    const notRegistered = buildStatus({ ...base, server: undefined, source: undefined, problems: [server] })
    expect([notRegistered.state, notRegistered.nextStep]).toEqual(["not_configured", "Restart OpenCode."])
    // Without the rules every agent lacks them: restarting fixes that, not pasting the block into each one.
    const rules = "RULES_NOT_ADDED: Wispr Flow's default permission rules could not be added (boom), so Wispr Flow tools may run without asking. Next step: Restart OpenCode."
    const unguarded = buildStatus({ ...base, problems: [rules], agents: [{ id: "build", permissions: [allow("*")] }] })
    expect(unguarded.unguardedAgents).toEqual(["build"])
    expect(unguarded.nextStep).toBe("Restart OpenCode.")
    // Another problem still comes after the agent fix, and the connection's own step comes first.
    const skills = 'SKILLS_INVALID: The "wisprflow" skill was not loaded: skills/wisprflow/SKILL.md is missing. Next step: Reinstall the plugin.'
    expect(buildStatus({ ...base, problems: [skills], agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toContain("Put the default rules")
    expect(buildStatus({ ...base, problems: [rules], server: { status: "needs_auth" } }).nextStep).toBe(SIGN_IN)
  })

  test("an untested host and setup problems show on the OpenCode row; a problem's own next step comes first", () => {
    const outside = checkHost("2.3.0", true)
    const problem = 'SKILLS_INVALID: The "wisprflow" skill was not loaded: skills/wisprflow/SKILL.md is missing. Next step: Reinstall the plugin.'
    const status = buildStatus({ ...base, host: outside, problems: [problem] })
    expect(status.nextStep).toBe("Reinstall the plugin.")
    expect(formatStatus(status)).toContain(
      `- OpenCode: 2.3.0 (untested; supported range >=2.2.3 <2.3.0). It is outside the supported range; the plugin runs because allowUntestedHost is true. If Wispr Flow misbehaves, use OpenCode 2.2.3, 2.2.4, 2.2.5 or 2.2.6. ${problem}`,
    )
    // The OpenCode row carries the warning; the next step stays the working state's.
    expect(buildStatus({ ...base, host: outside }).nextStep).toBe(NOTHING_TO_DO)
    // A release inside the range that the checks do not run on starts, is called untested, and changes no next step.
    const inside = buildStatus({ ...base, host: checkHost("2.2.99", false) })
    expect(inside).toMatchObject({ state: "connected", host: { version: "2.2.99", tested: false }, nextStep: NOTHING_TO_DO })
    expect(buildStatus({ ...base, host: checkHost("2.2.99", false), server: { status: "needs_auth" } }).nextStep).toBe(SIGN_IN)
    expect(formatStatus(inside)).toContain("- OpenCode: 2.2.99 (untested; supported range >=2.2.3 <2.3.0)\n")
    expect(formatStatus(buildStatus({ ...base, host: checkHost("2.2.5", false) }))).toContain("- OpenCode: 2.2.5 (tested; supported range >=2.2.3 <2.3.0)\n")
  })
})

function statusContext(overrides: { account?: Promise<unknown>; integrationID?: string; skills?: Promise<unknown> } = {}) {
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "github", status: { status: "connected" } }, { name: "wisprflow", status: { status: "connected" }, ...(overrides.integrationID ? { integrationID: overrides.integrationID } : {}) }] }) },
    agent: { list: async () => ({ data: [guarded, { id: "reviewer", permissions: [allow("*")] }] }) },
    tool: {
      list: async () => [
        { id: `wisprflow_${READ}`, name: READ, options: { namespace: "wisprflow" } },
        { id: "wisprflow_shiny_new_tool", name: "shiny_new_tool", options: { namespace: "wisprflow" } },
        { id: "wisprflow_work_get_me", name: "get_me", options: { namespace: "wisprflow_work" } },
        { id: "read", name: "read" },
      ],
    },
    skill: { list: () => overrides.skills ?? Promise.resolve({ data: [{ id: "wisprflow", path: "/projects/user/skills/wisprflow/SKILL.md" }] }) },
    integration: { connection: { active: () => overrides.account ?? Promise.resolve(undefined) } },
  }
  return ctx as unknown as StatusContext
}

describe("readStatus", () => {
  test("reads connection, account, tools, agents and skills through public APIs", async () => {
    const account = Promise.resolve({ type: "credential", id: "c", label: "Acme account", method: "oauth" })
    const status = await readStatus(statusContext({ integrationID: "mcp_1", account }), { access: "all", source: { type: "plugin", url: ENDPOINT }, host, skills: own, problems: [] })
    expect(status).toMatchObject({
      state: "connected",
      account: "Acme account",
      tools: 2,
      unknownTools: ["shiny_new_tool"],
      unguardedAgents: ["reviewer"],
      shadowedSkills: [{ name: "wisprflow", path: "/projects/user/skills/wisprflow/SKILL.md" }],
    })
  })

  test("a failed account or skill lookup leaves that part out, and the rest stands", async () => {
    const status = await readStatus(statusContext({ integrationID: "mcp_1", account: Promise.reject(new Error("offline")), skills: Promise.reject(new Error("no skills")) }), { access: "all", host, skills: own, problems: [] })
    expect(status.account).toBeUndefined()
    expect(status.shadowedSkills).toEqual([])
    expect(status.state).toBe("connected")
  })
})

describe("/wisprflow-status", () => {
  async function run(read: () => Promise<never> | ReturnType<typeof readStatus>) {
    const posted: unknown[] = []
    let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
    await registerStatusCommand(
      {
        command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
        session: { synthetic: async (input) => (posted.push(input), {}) as never },
      },
      read,
    )
    await execute!({ sessionID: "ses_1" })
    return posted
  }

  test("posts the status text into the session without starting a turn", async () => {
    const posted = await run(async () => buildStatus(base))
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(base)), description: "Wispr Flow status", resume: false }])
  })

  test("posts a coded error with a next step when status cannot be read", async () => {
    const posted = (await run(() => Promise.reject(new Error("host closed")))) as { text: string }[]
    expect(posted[0]!.text).toBe(
      "STATUS_UNAVAILABLE: Could not read Wispr Flow's status (host closed). Next step: Restart OpenCode, then run /wisprflow-status again.",
    )
  })

  test("cuts the host's error to one short line without URL queries", async () => {
    const posted = (await run(() => Promise.reject(new Error("failed:\n https://x.example/a?token=t")))) as { text: string }[]
    expect(posted[0]!.text).toBe("STATUS_UNAVAILABLE: Could not read Wispr Flow's status (failed: https://x.example/a). Next step: Restart OpenCode, then run /wisprflow-status again.")
  })
})

describe("status RPC", () => {
  async function register(read: () => Promise<Status>) {
    const registered: { id: string; methods: string[]; status: () => Promise<unknown> }[] = []
    // The host's error factory: the declared error's type, message and data.
    const error = (type: string, message: string, data: unknown) => ({ type, message, data })
    await registerStatusRpc(
      {
        register: async (definition, handlers) => {
          registered.push({ id: definition.id, methods: Object.keys(definition.methods), status: () => handlers.status({} as never, { error } as never) })
          return { dispose: async () => {}, events: { emit: async () => {} } } as never
        },
      },
      read,
    )
    return registered
  }

  test("serves the same status as /wisprflow-status through one read-only method", async () => {
    const registered = await register(async () => buildStatus(base))
    expect(registered.map(({ id, methods }) => ({ id, methods }))).toEqual([{ id: "wisprflow.meetings", methods: ["status"] }])
    expect(await registered[0]!.status()).toEqual(buildStatus(base))
    expect(StatusRpc.events).toEqual({})
  })

  test("answers a status it cannot read with its declared error, unavailable, and a next step", async () => {
    const registered = await register(() => Promise.reject(new Error("agent list failed")))
    expect(await registered[0]!.status()).toEqual({
      type: "unavailable",
      message: "STATUS_UNAVAILABLE: Could not read Wispr Flow's status (agent list failed).",
      data: { nextStep: "Restart OpenCode, then run /wisprflow-status again." },
    })
    expect(Object.keys(StatusRpc.methods.status.errors)).toEqual(["unavailable"])
  })

  test("has the fields every plugin of this family shares, with their names, and the access mode", () => {
    const status = buildStatus(base)
    expect({ version: status.version, host: status.host, state: status.state, unguardedAgents: status.unguardedAgents, nextStep: status.nextStep }).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      state: "connected",
      unguardedAgents: [],
      nextStep: NOTHING_TO_DO,
    })
    for (const old of ["connection", "agentsWithoutRules", "readOnly"]) expect(old in status).toBe(false)
    expect(status.access).toBe("all")
    expect(StatusRpc.methods.status.output.required).toEqual(expect.arrayContaining(["version", "host", "state", "unguardedAgents", "nextStep"]))
  })

  test("the output schema names every status field and requires the ones always present", () => {
    const { properties, required } = StatusRpc.methods.status.output
    const statuses: Status[] = [
      buildStatus({ ...base, account: "Acme", tools: ["shiny_new_tool"], agents: [{ id: "reviewer", permissions: [allow("*")] }], problems: ["p"] }),
      buildStatus({ ...base, server: { status: "failed", error: "fetch failed" }, source: { type: "conflict", url: "https://x.example/mcp", expected: ENDPOINT }, host: checkHost("2.3.0", true) }),
      buildStatus({ ...base, skills: { own, listed: [{ id: "wisprflow", path: "/projects/x/SKILL.md" }] } }),
    ]
    for (const status of statuses) {
      expect(Object.keys(status).filter((key) => !(key in properties))).toEqual([])
      expect(required.filter((key) => !(key in status))).toEqual([])
      expect(Object.keys(status.host).filter((key) => !(key in properties.host.properties))).toEqual([])
    }
  })
})
