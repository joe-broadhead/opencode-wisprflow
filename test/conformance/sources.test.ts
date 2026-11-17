// The source contract's conformance kit over the source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against a synthetic Wispr Flow: every meeting, name and link invented, in
// the JSON shape Wispr Flow's live search_meetings answers with. No Wispr Flow call, no sign-in. The reads go through a
// fake of OpenCode's executor that asserts `wisprflow_<tool>` on the kit's recording permission, as the host asserts
// it, so the kit sees exactly what each read asserts. The report is written to reports/conformance-report.json, for a
// release to attach; it holds no time or path, so every run writes the same bytes.
import { describe, expect, test } from "bun:test"
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

const NOW = Date.parse("2026-11-08T12:00:00Z")
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
 * Why no single meeting can fail on its own, for the kit's `failed-holds-cursor` check: one search_meetings call answers
 * each page whole, and a failed call fails the listing.
 */
const ATOMIC = "Wispr Flow's search_meetings answers each page of meetings whole, in one call, and a failed call fails the listing, so no single meeting fails on its own"

const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: "script:conformance", signal: new AbortController().signal, progress: async () => {} })
const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
const list = (input: Record<string, unknown>, session: SessionContext = open) => eventsMethod(context(session.permission), () => true, () => NOW).run(input, call()) as Promise<Record<string, any>>

async function cases(): Promise<PageCase[]> {
  const first = (await list({ since: SINCE, limit: 2 }))["cursor"] as string
  const done = (await list({ since: SINCE, limit: 500 }))["cursor"] as string
  const bound = (binding: { plugin: string; source: string; account: string }) => encodeBoundCursor(binding, { o: "0123456789abcdef", t: Date.parse(SINCE), i: "" })
  return [
    { name: "a first listing, one meeting refused for a secret", input: { since: SINCE }, expect: "page" },
    { name: "a first listing that names the account probe answers", input: { account: ACCOUNT, since: SINCE }, expect: "page" },
    { name: "what came after the first two", input: { account: ACCOUNT, cursor: first }, expect: "page" },
    { name: "the same, two at a time", input: { account: ACCOUNT, cursor: first, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { account: ACCOUNT, cursor: done }, expect: "empty" },
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
    expect(sources.items.map((item) => [item.id, item.kind])).toEqual([[SOURCE_ID, "events"]])
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
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    // A cursor is a meeting's start and id, which never expire, and Wispr Flow gives no sign of history it no longer
    // serves: the source never answers CURSOR_EXPIRED, so the kit's gap check cannot run and the report stays incomplete
    // on that one check.
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual(["gap-and-cursor-expired"])
  })

  test("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source)).toEqual([SOURCE_ID])
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
