import type { Plugin, Rpc } from "@opencode/plugin"
import { DISPLAY_NAME, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { shortReason } from "./redact.js"
import { defaultRules, unguardedAgents, type Rule } from "./permissions.js"
import { ASK_TOOLS, classify, WRITE_TOOLS } from "./wisprflow-tools.js"
import { VERSION } from "./version.js"

/** The shared status labels in machine form; `/wisprflow-status` shows them as `sign-in required` and so on. */
type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict"
/**
 * Who owns the `wisprflow` server: this plugin, the user's own config (adopted unchanged), or a server at another URL
 * than the plugin's (`expected`). URLs are shown as origin and path only.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string }
  | { readonly type: "adopted"; readonly url: string }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

/** A skill file OpenCode loads in place of one of the plugin's skills, because it uses the same id. */
export interface ShadowedSkill {
  /** The plugin's skill. */
  readonly name: string
  /** The file that takes its place. */
  readonly path: string
}

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  readonly account?: string
  readonly host: HostCheck
  /** The names of the tools the `wisprflow` server serves, without the `wisprflow_` prefix. */
  readonly tools?: readonly string[]
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  /** The plugin's own skills with their files, and the skills OpenCode lists; the listed one wins when both share an id. */
  readonly skills?: { readonly own: readonly { readonly name: string; readonly path: string }[]; readonly listed: readonly { readonly id: string; readonly path: string }[] }
  readonly problems?: readonly string[]
}

/**
 * One status model for `/wisprflow-status`, the `/wisprflow` dialog and the status RPC. `version`, `host`, `state`,
 * `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; the rest are Wispr Flow's own.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly state: State
  /** For a failed connection only: OpenCode's reason, on one line of at most 160 characters, URLs without their query. */
  readonly error?: string
  readonly account?: string
  readonly source?: ServerSource
  /** How many Wispr Flow tools OpenCode lists. */
  readonly tools: number
  /** How many of them the plugin does not know. */
  readonly unknownCount: number
  /** Up to 20 of the unknown tools' names, only those made of lowercase letters, digits and `_`. */
  readonly unknownTools: readonly string[]
  /** Agents where a new Wispr Flow tool would run without asking; empty when there are none. */
  readonly unguardedAgents: readonly string[]
  /** Skills OpenCode loads instead of the plugin's own; empty when there are none. */
  readonly shadowedSkills: readonly ShadowedSkill[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step: the `Next step` row, "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

const SIGN_IN = `Run /connect and choose ${DISPLAY_NAME}, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`

/** The default rules to paste into an agent's own permissions, one rule a line, as a JSON array body. */
const AGENT_RULES = defaultRules()
  .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
  .join("\n")

/** The next step while agents lack the rules: the family's one fixed sentence. */
const AGENTS_NEXT_STEP =
  "Put the default rules shown by /wisprflow-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Wispr Flow tools."

/** Connected, but Wispr Flow lists no tools: its account or organisation settings turn the connection's tools off. */
const NO_TOOLS_NEXT_STEP =
  "Wispr Flow lists no tools for this account. An active HIPAA agreement or an organisation policy turns its MCP off: check Wispr Flow's Settings → MCP or ask your admin, then run /wisprflow-status again."

const NOTHING_TO_DO = "Nothing to do."

/** The permission posture, one fixed sentence: it follows the known lists and the default rules. */
const ASKING = [...ASK_TOOLS, ...(WRITE_TOOLS.length ? ["changes"] : []), "new tools"]
const ACCESS_TEXT = `reads run without asking; ${ASKING.slice(0, -1).join(", ")}${ASKING.length > 1 ? " and " : ""}${ASKING.at(-1)} ask first`

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
// A tool name comes from the server; list only plain names: the characters OpenCode keeps in a permission action.
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

const STATE_OF = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" } as const

/** The plugin's skills that OpenCode lists from another file: a skill with the same id, such as a user's, replaced it. */
function shadowedOf(facts: StatusFacts): ShadowedSkill[] {
  return (facts.skills?.own ?? []).flatMap((own) => {
    const listed = facts.skills?.listed.find((skill) => skill.id === own.name)
    return listed && listed.path !== own.path ? [{ name: own.name, path: listed.path }] : []
  })
}

export function buildStatus(facts: StatusFacts): Status {
  const state: State = facts.source?.type === "conflict" ? "conflict" : facts.server ? STATE_OF[facts.server.status] : "not_configured"
  const unknown = (facts.tools ?? []).filter((tool) => classify(tool) === "unknown")
  // OpenCode's text for a needed sign-in can hold an authorization URL, so only a failure's reason is kept.
  const error = facts.server?.status === "failed" && facts.server.error ? shortReason(facts.server.error) : undefined
  const status = {
    version: VERSION,
    state,
    ...(error ? { error } : {}),
    ...(facts.account ? { account: facts.account } : {}),
    ...(facts.source ? { source: facts.source } : {}),
    tools: facts.tools?.length ?? 0,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? []),
    shadowedSkills: shadowedOf(facts),
    host: facts.host,
    problems: facts.problems ?? [],
  }
  return { ...status, nextStep: nextStepOf(status) }
}

/** Rename or move the skills that take the place of the plugin's own, so OpenCode loads the plugin's. */
function shadowedFix(skills: readonly ShadowedSkill[]) {
  const list = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]!)
  const paths = list(skills.map((skill) => skill.path))
  const names = list(skills.map((skill) => skill.name))
  return skills.length > 1
    ? `Rename or move the skills at ${paths}, which use the ids of the plugin's ${names} skills, so OpenCode loads the plugin's own.`
    : `Rename or move the skill at ${paths}, which uses the id of the plugin's ${names} skill, so OpenCode loads the plugin's own.`
}

function nextStepOf(status: Omit<Status, "nextStep">): string {
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step can become the status's.
  const stepOf = (problem: string | undefined) => problem?.split(" Next step: ")[1]
  const problemStep = (code: string) => stepOf(status.problems.find((problem) => problem.startsWith(`${code}: `)))
  switch (status.state) {
    case "conflict": {
      const { url, expected } = status.source as Extract<ServerSource, { type: "conflict" }>
      // Wispr Flow's sign-in does not start when the address ends with a slash, so say exactly that.
      if (url.replace(/\/+$/, "") === expected) {
        return `mcp.servers.${SERVER_NAME} is set to ${url}; ${DISPLAY_NAME}'s sign-in needs ${expected}, without the trailing slash. Change it or remove it, then restart OpenCode.`
      }
      return `mcp.servers.${SERVER_NAME} is set to ${url}, but ${DISPLAY_NAME}'s server is ${expected}. Point it there or remove it, then restart OpenCode.`
    }
    case "not_configured":
      // When the plugin could not register the server, that is why OpenCode has none.
      return (
        problemStep("SERVER_NOT_REGISTERED")
        ?? `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
      )
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return `${DISPLAY_NAME} is still connecting. Run /wisprflow-status again in a few seconds.`
    case "sign_in_required":
      return SIGN_IN
    case "failed":
      return "Check your network, then run /wisprflow-status again."
  }
  if (status.tools === 0) return NO_TOOLS_NEXT_STEP
  // When the rules could not be added, every agent lacks them: restarting fixes that, not pasting them everywhere.
  const rules = problemStep("RULES_NOT_ADDED")
  if (rules) return rules
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  const problem = stepOf(status.problems[0])
  if (problem) return problem
  if (status.shadowedSkills.length) return shadowedFix(status.shadowedSkills)
  // An untested host changes no next step: the OpenCode row says it is untested.
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
}

/** The server's address and owner, after the state label. */
function serverText(source: ServerSource) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}, used unchanged`
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`
}

function skillsText({ shadowedSkills }: Status) {
  return shadowedSkills.length ? shadowedSkills.map((skill) => `${skill.name} is replaced by ${skill.path}`).join("; ") : "the plugin's own"
}

function toolsText({ state, tools, unknownCount, unknownTools }: Status) {
  if (state === "connected" && tools === 0) return `0 available: ${DISPLAY_NAME} lists no tools for this account`
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (unknown tools ask before running)`
}

/** The OpenCode row: the version, whether it is tested, the supported range, then any setup problems. */
function hostText({ host, problems }: Status) {
  const { version, range, tested } = host
  const outside = version === null || !isSupportedHost(version)
  const notes = [
    ...(outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If ${DISPLAY_NAME} misbehaves, use OpenCode ${TESTED_TEXT}.`] : []),
    ...problems,
  ]
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`
}

export function formatStatus(status: Status) {
  const { source, unguardedAgents: agents } = status
  const details = [status.error, source && serverText(source)].filter(Boolean).join("; ")
  return [
    `${DISPLAY_NAME} status`,
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.account ?? `account name not reported by ${DISPLAY_NAME}'s MCP`}`,
    `- Access: ${ACCESS_TEXT}`,
    `- Skills: ${skillsText(status)}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}\n${AGENT_RULES}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
  readonly integration: { readonly connection: Pick<Plugin.Context["integration"]["connection"], "active"> }
}

/** What setup knows: the server's owner, the host check, the plugin's own skills and any setup problems. */
interface SetupFacts {
  readonly source?: ServerSource
  readonly host: HostCheck
  readonly skills: readonly { readonly name: string; readonly path: string }[]
  readonly problems: readonly string[]
}

/** Reads the live facts through public host APIs; never calls Wispr Flow. Optional lookups that fail leave their field empty. */
export async function readStatus(ctx: StatusContext, facts: SetupFacts) {
  const [servers, agents, tools, listed] = await Promise.all([
    ctx.mcp.list(),
    ctx.agent.list(),
    ctx.tool.list(),
    // The skill check is advice; a failed list must not hide the rest of the status.
    ctx.skill.list().then((result) => result.data, () => undefined),
  ])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const connection = server?.integrationID ? await ctx.integration.connection.active(server.integrationID).catch(() => undefined) : undefined
  return buildStatus({
    ...(facts.source ? { source: facts.source } : {}),
    host: facts.host,
    problems: facts.problems,
    ...(listed ? { skills: { own: facts.skills, listed } } : {}),
    ...(server ? { server: server.status } : {}),
    ...(connection?.type === "credential" ? { account: connection.label } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    agents: agents.data,
  })
}

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: `STATUS_UNAVAILABLE: Could not read ${DISPLAY_NAME}'s status${reason ? ` (${reason})` : ""}.`,
    nextStep: "Restart OpenCode, then run /wisprflow-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }

/**
 * One read-only method for the TUI view and scripts. The TUI part does not receive the plugin options on 2.2.x, and
 * cannot see the server's own findings, so it asks the server for the same status /wisprflow-status reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "tools", "unknownCount", "unknownTools", "unguardedAgents", "shadowedSkills", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          account: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" } },
          },
          tools: count,
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["name", "path"], properties: { name: { type: "string" }, path: { type: "string" } } },
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: { type: ["string", "null"] }, range: { type: "string" }, tested: { type: "boolean" } },
          },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "wisprflow-status",
      description: "Show Wispr Flow's connection, sign-in, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: `${DISPLAY_NAME} status`, resume: false })
      },
    }),
  )
}
