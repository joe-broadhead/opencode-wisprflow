// The handler table through its real entry: status, probe and events_list, with the contract's own consumer check for
// every page and snapshot, and the account, source and input refusals a caller can cause.
import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest } from "../../src/manifest.ts"
import { fakeHost, run, runtimeFor } from "../support/handlers.ts"

const runtime = runtimeFor()
const EVENTS_SOURCE = findSource(manifest, "wisprflow.meetings")
const LIST_SOURCE = findSource(manifest, "wisprflow.meetings.list")
if (EVENTS_SOURCE === undefined || LIST_SOURCE === undefined) throw new Error("the manifest declares no meetings sources")

function codeOf(action: () => Promise<unknown>): Promise<string | undefined> {
  return action().then(
    () => undefined,
    (error: unknown) => (error instanceof SourceError ? error.code : undefined),
  )
}

test("status names the plugin, its host, both accounts and no unguarded agent", async () => {
  const answer = (await run(runtime, "status", {})) as Record<string, unknown>
  assert.equal(answer.name, "wisprflow")
  assert.equal(answer.version, "0.0.0")
  assert.equal(answer.state, "ready")
  assert.equal(answer.nextStep, null)
  assert.deepEqual(answer.host, { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  const accounts = answer.accounts as Record<string, unknown>[]
  assert.deepEqual(accounts.map((account) => account.alias), ["work", "personal"])
  assert.deepEqual(accounts.map((account) => account.state), ["ready", "ready"])
  assert.deepEqual(accounts.map((account) => (account.owner as Record<string, unknown>).id), ["wisprflow:credential:cred-work", "wisprflow:credential:cred-personal"])
  assert.ok(accounts.every((account) => (account.owner as Record<string, unknown>).verified === false))
  assert.deepEqual(answer.unguardedAgents, [])
})

test("status names an agent that no longer holds the generated rules", async () => {
  const answer = (await run(runtime, "status", {}, "work", async () => ({ ok: true, agents: ["build", "reviewer"] }))) as Record<string, unknown>
  assert.deepEqual(answer.unguardedAgents, ["build", "reviewer"])
})

test("an unreadable agent list is a problem, never a false zero", async () => {
  const answer = (await run(runtime, "status", {}, "work", async () => ({ ok: false, error: "the agent list failed at https://example.test/x?token=secret-value" }))) as Record<string, unknown>
  assert.equal(answer.state, "error")
  assert.deepEqual(answer.unguardedAgents, [])
  assert.ok(String(answer.nextStep).includes("https://example.test/x?token=\u2026"))
  assert.ok(!String(answer.nextStep).includes("secret-value"))
})

test("status is needs_sign_in when an alias has no sign-in, and error when an alias is in error", async () => {
  const signedOut = runtimeFor(fakeHost({ signedIn: ["work"] }))
  const missing = (await run(signedOut, "status", {})) as Record<string, unknown>
  assert.equal(missing.state, "needs_sign_in")
  assert.deepEqual((missing.accounts as Record<string, unknown>[]).map((account) => account.state), ["ready", "needs_sign_in"])

  const failed = runtimeFor(fakeHost({ status: { personal: { status: "failed", error: "the server refused the refresh token" } } }))
  const broken = (await run(failed, "status", {})) as Record<string, unknown>
  assert.equal(broken.state, "error")
  assert.ok(String(broken.nextStep).includes("personal"))
})

test("probe answers the account's owner and no content", async () => {
  const answer = (await run(runtime, "probe", {}, "personal")) as Record<string, unknown>
  assert.equal(answer.account, "personal")
  assert.deepEqual(answer.owner, { id: "wisprflow:credential:cred-personal", label: "Wispr Flow (personal)", verified: false })
  assert.equal(answer.trust, "untrusted")
  assert.equal(answer.events, undefined)
  assert.equal(answer.data, undefined)
})

test("probe refuses an unknown source and a signed-out account", async () => {
  assert.equal(await codeOf(() => run(runtime, "probe", { source: "other" })), "SOURCE_UNKNOWN")
  const signedOut = runtimeFor(fakeHost({ signedIn: ["work"] }))
  assert.equal(await codeOf(() => run(signedOut, "probe", {}, "personal")), "NEEDS_SIGN_IN")
})

test("events_list answers a page the consumer's own check accepts", async () => {
  const answer = await run(runtime, "events_list", { source: "wisprflow", since: "2026-11-01" })
  assert.ok(EVENTS_SOURCE !== undefined)
  const accepted = acceptAnswer(EVENTS_SOURCE, "work", answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "events")
  assert.equal(accepted.page.events.length, 10)
  assert.equal(accepted.page.owner.id, "wisprflow:credential:cred-work")
})

test("events_list answers the meetings list snapshot, which the consumer's own check accepts", async () => {
  const answer = await run(runtime, "events_list", { source: "wisprflow", list: "meetings" })
  assert.ok(LIST_SOURCE !== undefined)
  const accepted = acceptAnswer(LIST_SOURCE, "work", answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "snapshot")
  const data = accepted.snapshot.data as { items: { id: string }[] }
  assert.equal(data.items[0]?.id, "w-06")
})

test("events_list refuses an unknown source, an invalid limit and a snapshot with a cursor", async () => {
  assert.equal(await codeOf(() => run(runtime, "events_list", { source: "other" })), "SOURCE_UNKNOWN")
  assert.equal(await codeOf(() => run(runtime, "events_list", { limit: 0 })), "INPUT_INVALID")
  assert.equal(await codeOf(() => run(runtime, "events_list", { list: "meetings", cursor: "x" })), "INPUT_INVALID")
  assert.equal(await codeOf(() => run(runtime, "events_list", { list: "other" })), "INPUT_INVALID")
})

test("events_list refuses a signed-out account before any read", async () => {
  const fake = fakeHost({ signedIn: ["work"] })
  const signedOut = runtimeFor(fake)
  assert.equal(await codeOf(() => run(signedOut, "events_list", { since: "2026-11-01" }, "personal")), "NEEDS_SIGN_IN")
  assert.deepEqual(fake.calls, [])
})

test("events_list keeps two aliases' pages apart", async () => {
  const work = (await run(runtime, "events_list", { since: "2026-11-01" }, "work")) as Record<string, unknown>
  const personal = (await run(runtime, "events_list", { since: "2026-11-01" }, "personal")) as Record<string, unknown>
  assert.equal(work.account, "work")
  assert.equal(personal.account, "personal")
  assert.deepEqual((personal.events as Record<string, unknown>[]).map((event) => event.external_id), ["p-01"])
})
