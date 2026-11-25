/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts, and one `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts, generates the access rules and builds the one bus
 * writer from the manifest's events. This file never calls `ctx.tool`, `ctx.rpc` or `ctx.permission` itself; the host
 * functions it passes to the provider are reads (`ctx.tool.list`, `ctx.mcp.list`, the active sign-in), not door code.
 */
import { Plugin } from "@opencode/plugin"
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerMcpAccounts } from "./accounts.ts"
import { handlersFor } from "./handlers/index.ts"
import { manifest, packageName, version } from "./manifest.ts"
import { createProvider, type ConnectionInfo, type Host, type ServerInfo, type ToolInfo } from "./provider/client.ts"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = context.options ?? {}
    const plan = accountsOf(manifest, options)
    if (!plan.ok) throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)

    // The vendor's MCP server holds the credentials: one server per alias, named <plugin> or <plugin>-<alias>.
    const accountRegistration = await registerMcpAccounts(context, manifest, options)

    const host: Host = {
      tools: async () => (await context.tool.list()) as unknown as readonly ToolInfo[],
      servers: async () => (await context.mcp.list()).data as unknown as readonly ServerInfo[],
      activeConnection: async (integrationID) => (await context.integration.connection.active(integrationID)) as ConnectionInfo | undefined,
    }

    const handlers = handlersFor({
      plugin: manifest.plugin.name,
      packageName,
      manifest,
      version,
      hostVersion: context.app.version,
      accounts: plan.value.accounts,
      accountProblems: accountRegistration.problems,
      provider: createProvider({ plugin: manifest.plugin.name, packageName, host }),
      clock: Date.now,
    })

    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
})
