/**
 * Wispr Flow's part of the tools RPC (`wisprflow.meetings.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/wisprflow.meetings.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks
 * `wisprflow_<tool>` against the same rules and sends OpenCode's own credential; `events_list` and `probe` run their
 * own specs. `docs/scripting.md` describes the calls.
 */
import type { Failure, McpResult, MethodSpec, NextSteps, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { EventsFailure } from "./events.js"
import { PERSONAL_TOOLS, READ_TOOLS, WRITE_TOOLS } from "./wisprflow-tools.js"

/** The RPC's id: the plugin's id and `.tools`, `wisprflow.meetings.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every tool this plugin knows, by exact upstream name, with the class the tools RPC reports. Every Wispr Flow tool
 * only reads, so all are `read`, `get_participant_contacts` included: the default block allows it like every other
 * tool, so a script calls it unless the user restricts it. An allowlist: a tool the server adds later is not a method
 * until it is classified in `src/wisprflow-tools.ts`, and `describe` lists it as unclassified.
 */
export const METHODS: readonly MethodSpec[] = [...READ_TOOLS, ...PERSONAL_TOOLS, ...WRITE_TOOLS].map((name): MethodSpec => ({
  kind: "mcp",
  name,
  class: "read",
}))

/** What the model path's `execute.before` hooks do to an MCP call's arguments, which the executor skips. Wispr Flow has none. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** What the model path's `execute.after` hooks do to a result, which the executor skips. Wispr Flow has no such hook. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Run /wisprflow-status, then point your own mcp.servers.${SERVER_NAME} in opencode.json at the URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: `Run /connect and choose Wispr Flow, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`,
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Check your network, then run /wisprflow-status and follow its next step.",
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /wisprflow-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /wisprflow-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /wisprflow-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
}

/** The plugin's own errors, thrown by plugin-owned specs, as a code, what happened and the next step: events_list's. */
export function pluginError(error: unknown): Failure | undefined {
  return error instanceof EventsFailure ? { code: error.code, what: error.what, next: error.next } : undefined
}

/** Wispr Flow's plugin value for the tools RPC. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
