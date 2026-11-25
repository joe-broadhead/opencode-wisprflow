// The manifest and the handler table: names, every method and its class, the two sources, and no handler for a
// pass-through MCP tool.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { checkManifest, manifestHash } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { methodEntries } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor } from "../../src/handlers/index.ts"
import { manifest, packageName, version } from "../../src/manifest.ts"
import { runtimeFor } from "../support/handlers.ts"

/** The 16 pass-through tool names from the recorded live capture of the vendor's tools/list. */
const LIVE = JSON.parse(readFileSync(new URL("../fixtures/live-tools.json", import.meta.url), "utf8")) as { tools: { name: string }[] }
const MCP_TOOLS = LIVE.tools.map((tool) => tool.name)

test("the package and the manifest share one name", () => {
  assert.equal(manifest.plugin.name, "wisprflow")
  assert.equal(packageName, "@we-the-rebel-alliance/wisprflow-plugin")
  assert.equal(version, "0.0.0")
  assert.equal(checkManifest(manifest).ok, true)
  assert.match(manifestHash(manifest), /^sha256:[0-9a-f]{64}$/)
})

test("the methods table classifies all 19 callables, including every pass-through tool", () => {
  const names = Object.keys(manifest.methods)
  assert.equal(names.length, 19)
  assert.deepEqual(names.filter((name) => !name.startsWith("mcp:")).sort(), ["events_list", "probe", "status"])
  assert.deepEqual(names.filter((name) => name.startsWith("mcp:")).map((name) => name.slice("mcp:".length)).sort(), [...MCP_TOOLS].sort())
  for (const [name, method] of Object.entries(manifest.methods)) {
    assert.equal(method.class, "read", name)
    if (name === "events_list" || name === "probe") assert.equal(method.accounts, "optional", name)
    else assert.ok(method.accounts === undefined || method.accounts === "none", name)
  }
  const asking = Object.entries(manifest.methods)
    .filter(([, method]) => method.effect === "ask")
    .map(([name]) => name)
    .sort()
  assert.deepEqual(asking, ["mcp:get_meeting_participants_enriched", "mcp:get_participant_contacts"])
  assert.equal(manifest.methods.events_list?.operations?.[0], "search_meetings")
})

test("the two sources name the same method, service, cadence and size", () => {
  const [events, snapshot] = manifest.sources
  assert.equal(events?.id, "wisprflow.meetings")
  assert.equal(events?.kind, "events")
  assert.equal(events?.reads, "meeting")
  assert.equal(snapshot?.id, "wisprflow.meetings.list")
  assert.equal(snapshot?.kind, "snapshot")
  assert.equal(snapshot?.output, "list")
  for (const source of [events, snapshot]) {
    assert.equal(source?.method, "events_list")
    assert.equal(source?.service?.id, "wisprflow.meetings")
    assert.equal(source?.service?.label, "Meetings")
    assert.equal(source?.cadence?.suggestMinutes, 5)
    assert.equal(source?.private, true)
    assert.equal(source?.cost?.class, "free")
    assert.equal(source?.maxBytes, 65_536)
    assert.deepEqual(source?.operations, ["search_meetings"])
  }
  assert.deepEqual(events?.input, { source: "wisprflow" })
  assert.deepEqual(snapshot?.input, { source: "wisprflow", list: "meetings" })
})

test("the plugin writes nothing and has no honest bus event", () => {
  assert.deepEqual(manifest.actions, [])
  assert.deepEqual(manifest.events, {})
})

test("the handler table matches the manifest's own methods, and no pass-through tool has a handler", () => {
  const runtime = runtimeFor()
  const entries = methodEntries(manifest, handlersFor(runtime))
  assert.deepEqual(entries.map((entry) => entry.name).sort(), ["events_list", "probe", "status"])
  for (const [name, handler] of Object.entries(handlersFor(runtime))) {
    assert.ok(Object.hasOwn(manifest.methods, name))
    assert.equal(typeof handler.run, "function")
  }
})

test("two aliases are two servers, and the default is the plugin's own name", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(plan.value.accounts.map((account) => account.alias), ["work", "personal"])
  assert.equal(accountName(manifest.plugin.name, "work"), "wisprflow-work")
  assert.equal(accountName(manifest.plugin.name, "personal"), "wisprflow-personal")
  assert.equal(accountName(manifest.plugin.name, "default"), "wisprflow")
})

test("the namespace line is inside the fixed-context budget", () => {
  assert.ok(manifest.plugin.summary.length <= 400)
  assert.ok(!manifest.plugin.summary.includes("\n"))
})
