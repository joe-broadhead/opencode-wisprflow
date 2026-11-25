// The shipped bundle in the real embedded OpenCode 2.4.1 host: every account's MCP server is registered. The project
// is empty and the config is isolated, so only the plugin's own registration can add a server.
import { ROOT } from "./isolate.ts"
import assert from "node:assert/strict"
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"
import { OpenCode } from "@opencode/sdk"

const root = fileURLToPath(new URL("../..", import.meta.url))
const VERSION = "2.4.1"

interface Client {
  readonly plugin: {
    list(input: { location: { directory: string } }): Promise<{ data: readonly { id?: string; state?: { status?: string; error?: string } }[] }>
  }
  readonly mcp: {
    list(input: { location: { directory: string } }): Promise<{ data: readonly { name: string }[] }>
  }
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

after(() => rmSync(ROOT, { recursive: true, force: true }))

async function until(what: string, check: () => Promise<unknown>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  for (;;) {
    try {
      if (await check()) return
    } catch (error) {
      last = error
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting until ${what}${last === undefined ? "" : `: ${last instanceof Error ? last.message : String(last)}`}`)
    }
    await sleep(100)
  }
}

test("registers one MCP server per account on the real host", { timeout: 180_000 }, async () => {
  const project = join(ROOT, "mcp-project")
  const config = join(ROOT, "mcp-config")
  mkdirSync(project, { recursive: true })
  mkdirSync(config, { recursive: true })
  writeFileSync(
    join(project, "opencode.jsonc"),
    JSON.stringify({ plugins: [{ package: root, options: { accounts: { default: {}, work: {} } } }] }, null, 2),
  )
  const location = { directory: project }
  assert.deepEqual(readdirSync(project), ["opencode.jsonc"])

  let client: Client | undefined
  try {
    client = (await OpenCode.create({
      app: { version: VERSION },
      config: { directory: config, project: true, claude: false },
      database: { path: join(ROOT, "mcp.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
      log: { level: "error", emit: () => {} },
    })) as unknown as Client

    await until("the plugin is active", async () => {
      const { data } = await client!.plugin.list({ location })
      const entry = data.find((item) => item.id === "wisprflow")
      if (entry?.state?.status === "failed") throw new Error(`the wisprflow plugin failed: ${entry.state.error ?? "no reason"}`)
      return entry?.state?.status === "active"
    })

    const servers = (await client.mcp.list({ location })).data.map((entry) => entry.name).sort()
    assert.deepEqual(servers, ["wisprflow", "wisprflow-work"])
  } finally {
    await client?.close().catch(() => undefined)
  }
})
