// The source contract's conformance kit over the source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against a synthetic Wispr Flow: every meeting, name and link invented, in
// the JSON shape Wispr Flow's live search_meetings answers with. No Wispr Flow call, no sign-in. The reads go through a
// fake of OpenCode's executor that asserts `wisprflow_<tool>` on the kit's recording permission, as the host asserts
// it, so the kit sees exactly what each read asserts. The report is written to reports/conformance-report.json, for a
// release to attach; it holds no time or path, so every run writes the same bytes.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { declarationProblems, sourceConformance, type ConformanceReport, type PageCase, type SessionContext } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { ACCOUNT, PACKAGE, SOURCE, SOURCE_ID, eventsMethod, probeMethod, type EventsContext } from "../../src/events.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
/** The declaration as Memory's schema parses it, which is what the kit takes. */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value
/** The contract version the kit ran from: the installed package's, which the pinned tag fixes. */
const CONTRACT_VERSION = (JSON.parse(readFileSync(join(root, "node_modules", "@we-the-rebel-alliance", "source-contract", "package.json"), "utf8")) as { version: string }).version
const tools = pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^wisprflow\./, ""), readOnly: tool.readOnly }))

/** The fixture's meetings start inside 30 days of NOW. That is the fixture, not a cutoff the listing applies. */
const NOW = Date.parse("2026-10-25T12:00:00Z")
const SINCE = "2026-09-28"
/** OpenCode's sign-in for wisprflow: its label is the integration's name, so the owner is the credential. */
const CREDENTIAL = { type: "credential", id: "cred-conformance", label: "Wispr Flow" }

/** Invented meetings, newest last here; search_meetings answers newest first. One title holds a password in a link: a secret to refuse. */
const MEETINGS = [
  { id: "w-01", title: "Kickoff", start_time: "2026-10-01T09:00:00Z", attendees: [{ name: "Ada Example", email: "ada@example.test" }], share_link: "https://notes.wisprflow.ai/shared/w-01" },
  { id: "w-02", title: "Their notes", start_time: "2026-10-02T15:00:00Z", attendees: [], shared: true, owner: { name: "Bo Placeholder" } },
  { id: "w-03", title: "Logs at ftp://ops:Hb3nQ8vTk2@logs.example.org/launch", start_time: "2026-10-05T10:00:00Z", attendees: [] },
  { id: "w-04a", title: "Tie A", start_time: "2026-10-09T08:00:00Z", attendees: [] },
  { id: "w-04b", title: "Tie B", start_time: "2026-10-09T08:00:00Z", attendees: [], has_transcript: true },
  { id: "w-05", title: "Retro", start_time: "2026-10-20T16:00:00Z", attendees: [{ name: "Lin Sample" }] },
]

/** search_meetings over MEETINGS, as Wispr Flow answers it: `since` inclusive, `until` exclusive, two a page. */
function search(input: Record<string, unknown>) {
  const since = Date.parse(String(input["since"]))
  const until = Date.parse(String(input["until"]))
  const matching = MEETINGS.filter((meeting) => Date.parse(meeting.start_time) >= since && Date.parse(meeting.start_time) < until).sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))
  const offset = typeof input["cursor"] === "string" ? Number(input["cursor"].replace(/^n-/, "")) : 0
  const page = matching.slice(offset, offset + 2).map((meeting) => ({ ...meeting, end_time: meeting.start_time, folders: null }))
  const more = offset + 2 < matching.length
  return { meetings: page, count: page.length, has_more: more, ...(more ? { next_cursor: `n-${offset + 2}` } : {}) }
}

/** OpenCode's context for the reads: the search_meetings executor asserts `wisprflow_search_meetings` first, as the host does. */
function context(permission: SessionContext["permission"]): EventsContext {
  return {
    tool: {
      list: async () =>
        [
          {
            id: "wisprflow_search_meetings",
            execute: async (input: Record<string, unknown>) => {
              await permission.assert({ action: "wisprflow_search_meetings", resources: ["*"] } as never)
              return { output: search(input) }
            },
          },
        ] as never,
    },
    mcp: { list: async () => ({ data: [{ name: "wisprflow", integrationID: "int-conformance", status: { status: "connected" } }] }) as never },
    permission: permission as never,
    integration: { connection: { active: async () => CREDENTIAL as never } },
  }
}

/**
 * Why no single meeting can fail on its own, for the kit's `failed-holds-cursor` check: events_list makes no call per
 * meeting. Every meeting comes whole from a search_meetings listing (a page may take a few of them, one per week and
 * Wispr Flow page), and any search_meetings call that fails fails the whole events_list call, so there is no partial page.
 */
const ATOMIC = "events_list makes no call per meeting: every meeting comes whole from a search_meetings listing, and a failed search_meetings call fails the whole events_list call, so no single meeting fails on its own"
/** Why a cursor does not expire here: no tool names the plan, so the listing does not invent a free-plan cutoff. */
const NO_EXPIRY = "No Wispr Flow tool names the plan, so a listing does not invent a 30-day free-plan cutoff and a cursor does not expire here. A 30-day cutoff applies only when the plan is known to be free"

const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: "script:conformance", signal: new AbortController().signal, progress: async () => {} })
const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
const list = (input: Record<string, unknown>, session: SessionContext = open) => eventsMethod(context(session.permission), () => true, () => NOW).run(input, call()) as Promise<Record<string, any>>

async function cases(): Promise<PageCase[]> {
  const first = (await list({ since: SINCE, limit: 2 }))["cursor"] as string
  const done = (await list({ since: SINCE, limit: 500 }))["cursor"] as string
  const bound = (binding: { plugin: string; source: string; account: string }) => encodeBoundCursor(binding, { o: "0123456789abcdef", t: Date.parse(SINCE), i: "" })
  // A cursor this sign-in was given 40 days before NOW. No tool names the plan, so the listing does not treat that as
  // an expired free-plan window: it lists what search_meetings returns. The owner digest is the one the source binds.
  const digest = createHash("sha256").update(`wisprflow:credential:${CREDENTIAL.id}`).digest("hex").slice(0, 16)
  const stale = encodeBoundCursor({ plugin: "wisprflow", source: SOURCE, account: ACCOUNT }, { o: digest, t: NOW - 40 * 86_400_000, i: "" })
  return [
    { name: "a first listing, one meeting refused for a secret", input: { since: SINCE }, expect: "page" },
    { name: "a first listing that names the account probe answers", input: { account: ACCOUNT, since: SINCE }, expect: "page" },
    { name: "what came after the first two", input: { account: ACCOUNT, cursor: first }, expect: "page" },
    { name: "the same, two at a time", input: { account: ACCOUNT, cursor: first, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { account: ACCOUNT, cursor: done }, expect: "empty" },
    { name: "a cursor older than 30 days still lists what the API returns", input: { account: ACCOUNT, cursor: stale }, expect: "page" },
    { name: "the same, two at a time, with no expired gap", input: { account: ACCOUNT, cursor: stale, limit: 2 }, expect: "page" },
    { name: "a first listing from before 30 days ago", input: { account: ACCOUNT, since: "2026-08-01", limit: 2 }, expect: "page" },
    { name: "a cursor without the account it reads", input: { cursor: first }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a cursor passed for another account", input: { account: "work", cursor: first }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "a cursor issued for another sign-in", input: { account: ACCOUNT, cursor: bound({ plugin: "wisprflow", source: SOURCE, account: ACCOUNT }) }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "another source's cursor", input: { account: ACCOUNT, cursor: bound({ plugin: "wisprflow", source: "notes", account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a cursor bound to another plugin", input: { account: ACCOUNT, cursor: bound({ plugin: "granola", source: SOURCE, account: ACCOUNT }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "an earlier version's unbound cursor", input: { account: ACCOUNT, cursor: encodeCursor(SOURCE, { a: ACCOUNT, o: "0123456789abcdef", t: 0, i: "" }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a source this plugin does not have", input: { source: "notes" }, expect: { refuses: "SOURCE_UNKNOWN" } },
  ]
}

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  test("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => [item.id, item.kind])).toEqual([
      [SOURCE_ID, "events"],
      ["wisprflow.meetings.list", "snapshot"],
    ])
    expect(sources.items.find((item) => item.id === "wisprflow.meetings.list")).toMatchObject({ output: "list", tool: "events_list" })
  })

  test(`${SOURCE_ID} keeps the contract`, async () => {
    const source = sources.items.find((item) => item.id === SOURCE_ID)!
    const report = await sourceConformance({
      plugin: pkg.name,
      source,
      tools,
      calls: {
        list: (input, session) => list(input as Record<string, unknown>, session),
        probe: (input, session) => probeMethod(context(session.permission), () => true).run(input, call()),
      },
      cases: await cases(),
      account: ACCOUNT,
      sources,
      describe: { id: TOOLS_RPC_ID },
      atomicPages: { reason: ATOMIC },
      noExpiry: { reason: NO_EXPIRY },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    // Every check that applies ran: the report is complete. The expired-cursor check does not apply, because no tool
    // names the plan and a listing does not invent a 30-day cutoff. failed[] is not applicable either (atomicPages).
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    expect(report.checks.filter((check) => check.ran).map((check) => check.name)).toEqual(expect.arrayContaining(["refused-is-final", "probe"]))
    expect(report.checks.find((check) => check.name === "gap-and-cursor-expired")).toMatchObject({ ran: false, notApplicable: true, reason: NO_EXPIRY })
    expect(report.checks.filter((check) => check.reason !== undefined).map((check) => check.name)).toEqual(["failed-holds-cursor", "gap-and-cursor-expired"])
    expect(report.ok).toBe(true)
  })

  test("wisprflow.meetings.list keeps the contract", async () => {
    const listed = sources.items.find((item) => item.id === "wisprflow.meetings.list")!
    const snapshot = (await eventsMethod(context(open.permission), () => true, () => NOW).run({ source: "wisprflow", list: "meetings", account: ACCOUNT }, call())) as {
      data: { items: { id: string; text: string }[]; editable: boolean }
      trust: string
    }
    expect(snapshot.trust).toBe("untrusted")
    expect(snapshot.data.editable).toBe(false)
    expect(snapshot.data.items.map((item) => item.id)).toContain("w-01")
    expect(snapshot.data.items.map((item) => item.id)).not.toContain("w-03")
    const report = await sourceConformance({
      plugin: pkg.name,
      source: listed,
      tools,
      calls: {
        snapshot: (input, session) => eventsMethod(context(session.permission), () => true, () => NOW).run(input, call()) as Promise<Record<string, unknown>>,
        probe: (input, session) => probeMethod(context(session.permission), () => true).run(input, call()),
      },
      snapshotCases: [{ ...(listed.input ?? {}), account: ACCOUNT }],
      cases: [],
      account: ACCOUNT,
      sources,
      describe: { id: TOOLS_RPC_ID },
      noExpiry: { reason: NO_EXPIRY },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    // The snapshot has no cursor either, and the source states why: no tool names the plan, so none expires here.
    expect(report.checks.find((check) => check.name === "gap-and-cursor-expired")).toMatchObject({ ran: false, notApplicable: true })
    expect(report.ok).toBe(true)
    expect(report.incomplete).toBe(false)
  })

  test("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source).sort()).toEqual([SOURCE_ID, "wisprflow.meetings.list"].sort())
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: `@we-the-rebel-alliance/source-contract@${CONTRACT_VERSION}`,
      plugin: pkg.name,
      version: pkg.version,
      descriptorHash: installed.ok ? installed.value.hash : null,
      ok: reports.every((entry) => entry.ok),
      sources: reports,
    }
    mkdirSync(join(root, "reports"), { recursive: true })
    writeFileSync(join(root, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  })
})
