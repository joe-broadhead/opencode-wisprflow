// The mcp account wiring: one vendor server per alias, named as the contract names it, and a bad option refused before
// anything is registered.
import assert from "node:assert/strict"
import { test } from "node:test"
import { registerMcpAccounts, type AccountsContext } from "../../src/accounts.ts"
import { manifest } from "../../src/manifest.ts"
import { MCP_URL } from "../../src/provider/client.ts"

/** A context with the two transforms, capturing the MCP servers a plugin registers. */
function context() {
  const servers = new Map<string, Record<string, unknown>>()
  const fake = {
    integration: {
      transform: async () => {
        throw new Error("the mcp mechanism must not touch the integration transform")
      },
    },
    mcp: {
      transform: async (callback: (editor: { set(name: string, config: Record<string, unknown>): void }) => void) => {
        callback({ set: (name, config) => void servers.set(name, config) })
        return { dispose: async () => undefined }
      },
    },
  } as unknown as AccountsContext
  return { fake, servers }
}

test("the mcp mechanism registers one server per alias, named for the account", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(registration.mechanism, "mcp")
  assert.deepEqual(registration.accounts.map((account) => account.name), ["wisprflow-work", "wisprflow-personal"])
  assert.deepEqual(servers.get("wisprflow-work"), { type: "remote", url: MCP_URL, oauth: {} })
  assert.deepEqual(servers.get("wisprflow-personal"), { type: "remote", url: MCP_URL, oauth: {} })
  assert.deepEqual(registration.problems, [])
})

test("with no accounts option the plugin has one default server", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, {})
  assert.deepEqual(registration.accounts.map((account) => account.alias), ["default"])
  assert.deepEqual(registration.accounts.map((account) => account.name), ["wisprflow"])
  assert.deepEqual(servers.get("wisprflow"), { type: "remote", url: MCP_URL, oauth: {} })
})

test("a bad alias is reported and registers no server", async () => {
  const { fake, servers } = context()
  const registration = await registerMcpAccounts(fake, manifest, { accounts: { Work: {} } })
  assert.ok(registration.problems.length > 0)
  assert.equal(servers.size, 0)
})

test("the vendor URL is named once, and no account name is part of it", () => {
  assert.equal(MCP_URL, "https://api.wisprflow.ai/connect/mcp")
})
