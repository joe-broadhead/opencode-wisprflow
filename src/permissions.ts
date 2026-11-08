import type { Plugin } from "@opencode/plugin"
import { DISPLAY_NAME, errorText, SERVER_NAME } from "./constants.js"
import { reasonOf } from "./redact.js"
import type { Access } from "./options.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "./wisprflow-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

/** The host's permission action for an MCP tool of the `wisprflow` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Rule["effect"]): Rule => ({ action: actionOf(tool), resource: "*", effect })

/**
 * Broad first, narrow last, because the last matching rule wins. Every tool the plugin registers is allowed at `access:
 * "all"`, and so is one Wispr Flow adds later; `ask-changes` asks for anything that is not a read, and `read-only`
 * denies it. The reads are always allowed, which is why the first rule alone decides the unknown tools.
 */
export const defaultRules = (access: Access = "all"): Rule[] => {
  const other: Rule["effect"] = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
  return [
    rule("*", other),
    ...[...READ_TOOLS, ...ASK_TOOLS].map((tool) => rule(tool, "allow")),
    ...WRITE_TOOLS.map((tool) => rule(tool, other)),
  ]
}

const same = (a: Rule | undefined, b: Rule) => a?.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }
const isBaseAllow = (item: Rule) => same(item, BASE_ALLOW)

/**
 * True when the whole default block appears, in order, anywhere after the agent's first base allow: inserted by the
 * plugin or copied by the user. Other plugins insert their blocks at the same index, so it need not follow directly.
 */
export function hasDefaultRules(permissions: readonly Rule[], access: Access = "all") {
  const base = permissions.findIndex(isBaseAllow)
  if (base === -1) return false
  const block = defaultRules(access)
  return permissions.some((_, start) => start > base && block.every((item, offset) => same(permissions[start + offset], item)))
}

/**
 * Splices `rules` in right after the agent's first base `* * allow`, by index. Everything later still wins: the agent's
 * own stricter rules (Plan, Explore), the user's `permissions`, and saved approvals. Agents without a base allow, or
 * that already carry the rules, are left alone: there, the block's ask would loosen a default deny. Returns whether it
 * inserted.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[]) {
  if (hasDefaultRules(permissions)) return false
  const base = permissions.findIndex(isBaseAllow)
  if (base === -1) return false
  permissions.splice(base + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules))
      report(undefined)
    } catch (error) {
      report(errorText("RULES_NOT_ADDED", `${DISPLAY_NAME}'s default permission rules could not be added (${reasonOf(error)}), so ${DISPLAY_NAME} tools may run without asking.`, "Restart OpenCode."))
    }
  })
}

const wildcard = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The host's evaluation for an MCP call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(permissions: readonly Rule[], action: string): Rule["effect"] {
  return permissions.findLast((item) => wildcard(item.action).test(action) && wildcard(item.resource).test("*"))?.effect ?? "ask"
}

/**
 * Agents that need the per-agent fix: they have a base allow but not the block (for example agents defined only in the
 * user's config, which OpenCode creates after plugins run), and their own rules would let a Wispr Flow tool this plugin
 * does not know run without asking. An agent whose rules already ask or deny for every Wispr Flow tool is not listed.
 */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) =>
  agents
    .filter((agent) => agent.permissions.some(isBaseAllow) && !hasDefaultRules(agent.permissions) && evaluate(agent.permissions, actionOf("new_tool")) === "allow")
    .map((agent) => agent.id)
