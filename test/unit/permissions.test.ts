import { describe, expect, test } from "bun:test"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const [READ_A, READ_B] = READ_TOOLS as [string, string]
// A known write when Wispr Flow lists one; an unknown tool follows the same rule.
const WRITE = WRITE_TOOLS[0] ?? "made_up_write"
const ask: Rule = { action: "wisprflow_*", resource: "*", effect: "ask" }
const denyAll: Rule = { action: "wisprflow_*", resource: "*", effect: "deny" }
const effects = (rules: readonly Rule[]) => [`wisprflow_${READ_A}`, `wisprflow_${READ_B}`, `wisprflow_${WRITE}`, "wisprflow_shiny_new_tool"].map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("allow every Wispr Flow tool by default, reads and a tool Wispr Flow adds later alike", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual({ action: "wisprflow_*", resource: "*", effect: "allow" })
    expect(rules.slice(1)).toEqual([
      ...[...READ_TOOLS, ...ASK_TOOLS].map((tool): Rule => ({ action: `wisprflow_${tool}`, resource: "*", effect: "allow" })),
      ...WRITE_TOOLS.map((tool): Rule => ({ action: `wisprflow_${tool}`, resource: "*", effect: "allow" })),
    ])
    expect(rules.filter((rule) => rule.effect !== "allow")).toEqual([])
    expect(effects([allow("*"), ...defaultRules()])).toEqual(["allow", "allow", "allow", "allow"])
  })

  test("ask-changes allows reads and asks for everything else, new tools included", () => {
    const rules = defaultRules("ask-changes")
    expect(rules[0]).toEqual(ask)
    expect(effects([allow("*"), ...rules])).toEqual(["allow", "allow", "ask", "ask"])
    for (const tool of ASK_TOOLS) expect(evaluate([allow("*"), ...rules], `wisprflow_${tool}`)).toBe("allow")
  })

  test("read-only allows reads and denies everything else, new tools included", () => {
    const rules = defaultRules("read-only")
    expect(rules[0]).toEqual(denyAll)
    expect(effects([allow("*"), ...rules])).toEqual(["allow", "allow", "deny", "deny"])
    for (const tool of ASK_TOOLS) expect(evaluate([allow("*"), ...rules], `wisprflow_${tool}`)).toBe("allow")
  })

  test("a user's later rule still wins, whichever access the block came from", () => {
    expect(evaluate([allow("*"), ...defaultRules("ask-changes"), allow(`wisprflow_${WRITE}`)], `wisprflow_${WRITE}`)).toBe("allow")
    expect(evaluate([allow("*"), ...defaultRules("all"), { action: `wisprflow_${READ_A}`, resource: "*", effect: "deny" }], `wisprflow_${READ_A}`)).toBe("deny")
  })
})

describe("insertRules", () => {
  test("splices the rules right after the base allow, before the agent's own rules", () => {
    const [build, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    const rules = defaultRules()
    for (const agent of [build, plan, explore]) {
      const before = agent.permissions.slice()
      expect(insertRules(agent.permissions, rules)).toBe(true)
      expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
    }
  })

  test("is idempotent, and also when another plugin's block came first", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    const once = permissions.slice()
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual(once)
    const shared = [allow("*"), allow("github_*"), ...defaultRules()]
    expect(insertRules(shared, defaultRules())).toBe(false)
  })

  test("a user's lone wisprflow_* ask is not the block, so the block is still added before it", () => {
    const own = [allow("*"), { ...ask }, allow(`wisprflow_${WRITE}`)]
    expect(hasDefaultRules(own)).toBe(false)
    expect(insertRules(own, defaultRules())).toBe(true)
    expect(own.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
    expect(evaluate(own, `wisprflow_${WRITE}`)).toBe("allow")
  })

  test("leaves agents without a base allow untouched and never throws on odd lists", () => {
    for (const permissions of [[], [{ action: "*", resource: "*", effect: "deny" }], [allow("read")]] as Rule[][]) {
      const before = permissions.slice()
      expect(insertRules(permissions, defaultRules())).toBe(false)
      expect(permissions).toEqual(before)
    }
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules())
    expect(effects(explore.permissions)).toEqual(["deny", "deny", "deny", "deny"])
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "allow", "allow"])
    insertRules(plan.permissions, defaultRules("ask-changes"))
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "allow", "allow"])
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(allow(`wisprflow_${WRITE}`), { action: `wisprflow_${READ_A}`, resource: "*", effect: "ask" })
    expect(effects(permissions)).toEqual(["ask", "allow", "allow", "allow"])
  })
})

describe("registerDefaultRules", () => {
  test("adds the rules to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(agent.permissions.filter((rule) => rule.action === "wisprflow_*")).toHaveLength(1)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems).toEqual([
      "RULES_NOT_ADDED: Wispr Flow's default permission rules could not be added (boom), so Wispr Flow tools may run without asking. Next step: Restart OpenCode.",
    ])
  })
})

describe("unguardedAgents", () => {
  test("names agents with a base allow, without the block, where a new Wispr Flow tool would run without asking", () => {
    const guarded = [allow("*"), ...defaultRules()]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules(), allow(`wisprflow_${WRITE}`)] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules()] },
      // The block before the base allow does not count: the base allow comes later and wins.
      { id: "before-base", permissions: [...defaultRules(), allow("*")] },
      // The ask-changes marker is not the all-allow block, so the all-allow block is still added, and the marker
      // would leave a new tool asking if it were all an agent had. It is not listed: its own rules restrict.
      { id: "marker-only", permissions: [allow("*"), { ...ask }] },
      { id: "locked", permissions: [allow("*"), { action: "*", resource: "*", effect: "deny" as const }] },
      { id: "denies", permissions: [allow("*"), { action: "wisprflow_*", resource: "*", effect: "deny" as const }] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "before-base"])
    expect(hasDefaultRules(guarded)).toBe(true)
    expect(hasDefaultRules(agents[4]!.permissions)).toBe(false)
  })

  test("an agent without a base allow is never listed, even when its own rules allow Wispr Flow tools", () => {
    expect(unguardedAgents([{ id: "own", permissions: [allow("wisprflow_*")] }, { id: "empty", permissions: [] }])).toEqual([])
  })
})
