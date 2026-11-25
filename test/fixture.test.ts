// The recording and the handlers agree: every recorded page, snapshot, probe, refusal and status is what the plugin
// answers today, so the fixture cannot drift from the code the conformance kit runs.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest, packageName } from "../src/manifest.ts"
import { run, runtimeFor } from "./support/handlers.ts"

interface RecordedCase {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expect?: unknown
  readonly answer?: unknown
  readonly refuses?: string
}

interface Recorded {
  readonly plugin: string
  readonly namespace: string
  readonly accounts: { readonly real: boolean; readonly aliases: readonly string[]; readonly required: { readonly method: string; readonly code: string }; readonly unknown: { readonly method: string; readonly account: string; readonly code: string }; readonly cursors: readonly { readonly method: string; readonly account: string; readonly other: string; readonly code: string }[] }
  readonly sources: Record<
    string,
    {
      readonly cases?: readonly RecordedCase[]
      readonly probe?: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown }
      readonly snapshot?: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown }
    }
  >
  readonly events: { readonly emitted: readonly string[]; readonly status: unknown }
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8")) as Recorded
const runtime = runtimeFor()
const eventsSource = findSource(manifest, "wisprflow.meetings")
const listSource = findSource(manifest, "wisprflow.meetings.list")
if (eventsSource === undefined || listSource === undefined) throw new Error("the manifest declares no meetings sources")
const recordedEvents = fixture.sources["wisprflow.meetings"]
const recordedList = fixture.sources["wisprflow.meetings.list"]
if (recordedEvents === undefined || recordedList === undefined) throw new Error("the fixture records no meetings sources")

/** The input a handler sees: `register` removes the account selector. */
function withoutAccount(input: Readonly<Record<string, unknown>>): { readonly account: string; readonly input: Record<string, unknown> } {
  const { account, ...rest } = input
  return { account: typeof account === "string" ? account : "work", input: rest }
}

test("the fixture was recorded for this package, its namespace and the real two-account run", () => {
  assert.equal(fixture.plugin, packageName)
  assert.equal(fixture.namespace, manifest.plugin.summary)
  assert.equal(fixture.accounts.real, true)
  assert.deepEqual(fixture.accounts.aliases, ["work", "personal"])
  assert.deepEqual(fixture.accounts.required, { method: "events_list", code: "ACCOUNT_REQUIRED" })
  assert.deepEqual(fixture.accounts.unknown, { method: "events_list", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" })
  assert.deepEqual(fixture.accounts.cursors, [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }])
})

test("every recorded page and refusal is what the handlers answer today", async () => {
  for (const item of recordedEvents.cases ?? []) {
    const { account, input } = withoutAccount(item.input)
    if (item.refuses !== undefined) {
      await assert.rejects(
        () => run(runtime, "events_list", input, account),
        (error: unknown) => error instanceof SourceError && error.message === item.refuses,
        item.name,
      )
      continue
    }
    const answer = await run(runtime, "events_list", input, account)
    assert.deepEqual(answer, item.answer, item.name)
    const accepted = acceptAnswer(eventsSource!, account, answer)
    if (!accepted.ok) throw new Error(`${item.name}: ${accepted.failure.message}`)
  }
})

test("the recorded probe is what the probe handler answers today", async () => {
  const probe = recordedEvents.probe
  if (probe === undefined) throw new Error("the fixture records no probe")
  const { account, input } = withoutAccount(probe.input)
  assert.deepEqual(await run(runtime, "probe", input, account), probe.answer)
})

test("the recorded snapshot is what the list handler answers today", async () => {
  const snapshot = recordedList.snapshot
  if (snapshot === undefined) throw new Error("the fixture records no snapshot")
  const { account, input } = withoutAccount(snapshot.input)
  const answer = await run(runtime, "events_list", input, account)
  assert.deepEqual(answer, snapshot.answer)
  const accepted = acceptAnswer(listSource!, account, answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
})

test("the recorded status is what the status handler answers today", async () => {
  assert.deepEqual(await run(runtime, "status", {}), fixture.events.status)
})

test("the fixture declares no bus event for a plugin that emits none", () => {
  assert.deepEqual(fixture.events.emitted, [])
})
