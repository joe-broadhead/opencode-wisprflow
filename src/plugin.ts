import { Plugin, type Mcp } from "@opencode/plugin"
import { errorText, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { eventsMethod, registerEvents } from "./events.js"
import { checkHost } from "./host-version.js"
import { registerToolsRpc } from "./host/tools-rpc.js"
import { watchIntegration } from "./integration.js"
import { parseOptions } from "./options.js"
import { reasonOf } from "./redact.js"
import { defaultRules, registerDefaultRules } from "./permissions.js"
import { loadSkills, registerSkills } from "./skills.js"
import { readStatus, registerStatusCommand, registerStatusRpc, type ServerSource } from "./status.js"

/** Internal seam: tests point the server at a loopback fake without OAuth, and at their own skills. */
interface WisprflowSeam {
  readonly endpoint: string
  readonly oauth?: false
  readonly skillsDir?: string
}

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/**
 * No oauth block: OpenCode chooses the client registration Wispr Flow advertises and requests the scopes its sign-in
 * challenge names. No protocol, codemode, timeout or headers: the host defaults apply.
 */
export const serverConfig = (seam: WisprflowSeam): RemoteConfig => ({
  type: "remote",
  url: seam.endpoint,
  ...(seam.oauth === false ? { oauth: false as const } : {}),
})

/**
 * Origin and path only, so a token in a query string never reaches status. A trailing slash is kept: Wispr Flow's
 * sign-in does not start with one, so it is a different server address here.
 */
export function displayUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return "an invalid URL"
  }
}

/**
 * A conflicting server's address for status. Another origin shows only its origin, because its path can hold a secret,
 * as some servers' URLs do. The plugin's own origin keeps its path, which the trailing-slash case needs.
 */
export function conflictUrl(url: string, expected: string) {
  try {
    const parsed = new URL(url)
    if (parsed.origin === new URL(expected).origin) return displayUrl(url)
    return parsed.pathname === "/" ? parsed.origin : `${parsed.origin}/…`
  } catch {
    return "an invalid URL"
  }
}

/**
 * Registers `wisprflow`, or adopts the user's own `mcp.servers.wisprflow` unchanged when it points at exactly the
 * plugin's URL: user config is applied first, and a later `set` would replace it. Any other URL, the same one with a
 * trailing slash included, is a conflict, and nothing is added. Synchronous and never throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  config: RemoteConfig,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const existing = editor.get(SERVER_NAME)
      const expected = displayUrl(config.url)
      if (!existing) {
        editor.set(SERVER_NAME, config)
        return record({ type: "plugin", url: expected })
      }
      if (existing.type === "remote" && displayUrl(existing.url) === expected) return record({ type: "adopted", url: expected })
      const url = existing.type === "remote" ? conflictUrl(existing.url, config.url) : "a local command"
      record({ type: "conflict", url, expected })
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

export function createWisprflowPlugin(seam: WisprflowSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const options = parseOptions(ctx.options)
      const host = checkHost(ctx.app.version, options.allowUntestedHost)
      const { skills, problems: skillProblems } = await loadSkills(seam.skillsDir)
      // Transforms replay on every rebuild, so each one overwrites its own entry rather than appending.
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))
      let source: ServerSource | undefined

      await registerServer(ctx.mcp, serverConfig(seam), (next, problem) => {
        source = next
        report("server")(problem)
      })
      // Code Mode's catalog describes the server's namespace with this text, unless the server is someone else's.
      await ctx.tool.transform((editor) => {
        if (source?.type !== "conflict") editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })
      })
      // events_list, Memory's source of meetings, reads through the server's search_meetings; not beside someone else's.
      const ours = () => source?.type !== "conflict"
      await registerEvents(ctx, ours)
      await registerDefaultRules(ctx.agent, defaultRules(), report("rules"))
      const own = skills.map(({ name, path }) => ({ name, path }))
      const read = () => readStatus(ctx, { ...(source ? { source } : {}), host, skills: own, problems: [...problems.values()] })
      // The plugin's own server, or the user's adopted one; a server at another URL is not Wispr Flow's.
      const owned = () => source?.type === "plugin" || source?.type === "adopted"
      await registerSkills(ctx.skill, skills)
      await registerStatusCommand(ctx, read)
      await registerStatusRpc(ctx.rpc, read)
      // Scripts call the known reads and events_list with no model, as a session and its agent.
      // Only a conflict is someone else's server; a server that isn't registered is NOT_REGISTERED, not a conflict.
      const stopTools = await registerToolsRpc(ctx, { mcp: { server: SERVER_NAME, managed: ours }, owned: [eventsMethod(ctx, ours)] })
      const stopWatch = watchIntegration(ctx, owned)
      return async () => {
        await stopWatch()
        await stopTools()
      }
    },
  })
}
