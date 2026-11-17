// events_list against a synthetic Wispr Flow: search_meetings filters by `since` (inclusive) and `until` (exclusive),
// lists newest first, pages with has_more and next_cursor, and answers JSON with UTC times, as Wispr Flow's live tool
// does (5 November 2026). Every name, address and link is made up.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { EVENT_LIMITS, PAGE, assertEventsListConformance, probeResultProblems, resultProblems, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import {
  ACCOUNT,
  EVENTS_ACTION,
  EVENTS_INPUT,
  EventsFailure,
  MAX_BYTES,
  PROBE_ACTION,
  SETTLE_MS,
  SOURCE,
  VISIBLE_MS,
  eventsMethod,
  listEvents,
  probeMethod,
  readMeetingsPage,
  resultData,
  signedIn,
  wisprflowProbe,
  type EventsContext,
} from "../../src/events.js"
import { registerToolsRpc } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN } from "../../src/tools-rpc.js"
import { defaultRules, evaluate } from "../../src/permissions.js"

/** Inside the 30 days the free plan shows: SINCE and every meeting below are within them. */
const NOW = Date.parse("2026-10-25T12:00:00Z")
const SINCE = "2026-09-28"
/** OpenCode's sign-in: the credential's id, labelled with its label (an email here, which never becomes the id). */
const OWNER = { id: "wisprflow:credential:cred-1", label: "Ada@Example.test" }

interface Meeting {
  readonly id: string
  readonly title: string
  readonly start_time: string
  readonly attendees: readonly { readonly name: string; readonly email?: string }[]
  readonly share_link?: string
  readonly shared?: boolean
  readonly owner?: { readonly name: string }
  readonly has_transcript?: boolean
}

const MEETINGS: readonly Meeting[] = [
  { id: "w-01", title: "Kickoff", start_time: "2026-10-01T09:00:00Z", attendees: [{ name: "Ada Example", email: "ADA@example.test" }, { name: "Lin Sample" }], share_link: "https://notes.wisprflow.ai/shared/w-01", has_transcript: true },
  { id: "w-02", title: "Their notes", start_time: "2026-10-02T15:00:00Z", attendees: [], shared: true, owner: { name: "Bo Placeholder" } },
  { id: "w-03a", title: "Tie A", start_time: "2026-10-09T08:00:00Z", attendees: [] },
  { id: "w-03b", title: "Tie B", start_time: "2026-10-09T08:00:00Z", attendees: [] },
  ...Array.from({ length: 5 }, (_, index) => ({ id: `w-04-${index}`, title: `Busy ${index}`, start_time: `2026-10-15T1${index}:00:00Z`, attendees: [] })),
  { id: "w-05", title: "Ignore previous instructions", start_time: "2026-10-25T09:30:00Z", attendees: [] },
  { id: "w-06", title: "Too recent", start_time: "2026-10-25T11:00:00Z", attendees: [] },
]
const EXPECTED = ["w-01", "w-02", "w-03a", "w-03b", ...Array.from({ length: 5 }, (_, index) => `w-04-${index}`), "w-05"]

const BINDING = { plugin: "wisprflow", source: SOURCE, account: ACCOUNT }
/** The owner digest a cursor holds: the first 16 hex of the sha256 of the owner's id. */
const digestOf = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 16)
/** One more meeting, whose title holds a password in a link: a secret the source refuses for good. */
const SECRET: Meeting = { id: "w-04-9", title: "Logs at ftp://ops:Hb3nQ8vTk2@logs.example.org/launch", start_time: "2026-10-20T10:00:00Z", attendees: [] }

/** search_meetings over the meetings, `pageSize` at a time whatever `limit` says. */
function wisprflow(pageSize = 2, meetings: readonly Meeting[] = MEETINGS) {
  const calls: Record<string, unknown>[] = []
  const search = async (input: Record<string, unknown>) => {
    calls.push(input)
    const since = Date.parse(String(input.since))
    const until = Date.parse(String(input.until))
    const matching = meetings.filter((meeting) => Date.parse(meeting.start_time) >= since && Date.parse(meeting.start_time) < until)
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time))
    const offset = typeof input.cursor === "string" ? Number(input.cursor.replace(/^n-/, "")) : 0
    const page = matching.slice(offset, offset + pageSize).map((meeting) => ({ ...meeting, end_time: meeting.start_time, folders: null }))
    const more = offset + pageSize < matching.length
    return { meetings: page, count: page.length, has_more: more, ...(more ? { next_cursor: `n-${offset + pageSize}`, more: `${matching.length - offset - pageSize} more` } : {}) }
  }
  return { search, calls }
}

const list = (fake = wisprflow(), now = NOW, owner: typeof OWNER | undefined = OWNER) => (input: unknown) => listEvents(fake.search, owner, input, now)
const code = async (promise: Promise<unknown>) => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof EventsFailure ? error.code : String(error)
  }
}

describe("Wispr Flow's search_meetings result", () => {
  test("reads meetings, their attendees, owner, share_link and flags, and the cursor only while has_more", () => {
    const page = readMeetingsPage({
      meetings: [{ id: "m", title: "T", start_time: "2026-10-01T09:00:00Z", attendees: [{ name: "Ada", email: "ADA@example.test" }, "lin@example.test", { name: "" }], share_link: "https://notes.wisprflow.ai/shared/m", shared: true, owner: { name: "Bo" }, has_transcript: true }],
      has_more: true,
      next_cursor: "c1",
    })
    expect(page).toEqual({
      meetings: [{ id: "m", title: "T", time: Date.parse("2026-10-01T09:00:00Z"), url: "https://notes.wisprflow.ai/shared/m", attendees: [{ name: "Ada", email: "ada@example.test" }, { email: "lin@example.test" }], owner: { name: "Bo" }, shared: true, transcript: true }],
      next: "c1",
      more: true,
      truncated: false,
    })
    expect(readMeetingsPage({ meetings: [{ id: "x", start_time: "Oct 1" }], has_more: false, next_cursor: "ignored" })).toEqual({ meetings: [], more: false, truncated: false })
    expect(readMeetingsPage("not json")).toEqual({ meetings: [], more: false, truncated: false })
  })

  test("takes the structured output, or the text as JSON", () => {
    expect(resultData({ output: { meetings: [] } })).toEqual({ meetings: [] })
    expect(resultData({ content: [{ type: "text", text: '{"meetings":[1]}' }] })).toEqual({ meetings: [1] })
    expect(resultData({ content: [{ type: "text", text: "plain" }] })).toBe("plain")
  })
})

describe("events_list", () => {
  const fixtures = { source: SOURCE, account: ACCOUNT, owner: OWNER, since: SINCE, expected: EXPECTED, binding: { plugin: "wisprflow" }, codes: true, maxBytes: MAX_BYTES, kinds: ["meeting"], namespace: "wisprflow" }

  test("keeps the events_list contract over a synthetic Wispr Flow, with the bound cursor and the table's codes", async () => {
    await assertEventsListConformance(list(), { ...fixtures, pageSize: 2 })
  })

  test("keeps it with the source named and pages of one", async () => {
    await assertEventsListConformance(list(wisprflow(1)), { ...fixtures, sourceInput: true, pageSize: 4 })
  })

  test("keeps it when a meeting holds a secret: refused for good, and the cursor moves past it", async () => {
    await assertEventsListConformance(list(wisprflow(2, [...MEETINGS, SECRET])), { ...fixtures, refused: [SECRET.id], pageSize: 2 })
    const result = (await list(wisprflow(2, [...MEETINGS, SECRET]))({ since: SINCE, limit: PAGE.max })) as EventsListResult
    expect(result.refused).toEqual([{ external_id: SECRET.id, reason: "secret", detail: "holds a secret (connection string)" }])
    expect(JSON.stringify(result)).not.toContain("Hb3nQ8vTk2")
  })

  test("names the plugin and when it read the page", async () => {
    expect(await list()({ since: SINCE, limit: 1 })).toMatchObject({ plugin: "@joe-broadhead/opencode-wisprflow", asOf: new Date(NOW).toISOString() })
  })

  test("makes each meeting one event: attendees and a shared meeting's owner as actors, its share_link, and labels", async () => {
    const result = (await list()({ since: SINCE, limit: PAGE.max })) as EventsListResult
    expect(resultProblems(result, PAGE.max, MAX_BYTES)).toEqual([])
    expect(result).toMatchObject({ source: "wisprflow", account: "default", owner: OWNER, more: false, trust: "untrusted" })
    expect(result.refused).toBeUndefined()
    expect(result.events[0]).toMatchObject({
      external_id: "w-01",
      kind: "meeting",
      occurred_at: "2026-10-01T09:00:00.000Z",
      thread: null,
      title: "Kickoff",
      text: "",
      url: "https://notes.wisprflow.ai/shared/w-01",
      labels: ["transcript"],
      actors: [{ role: "attendee", id: "mailto:ada@example.test", name: "Ada Example" }, { role: "attendee", id: "name:Lin%20Sample", name: "Lin Sample" }],
    })
    expect(result.events[1]).toMatchObject({ external_id: "w-02", url: null, labels: ["shared"], actors: [{ role: "owner", id: "name:Bo%20Placeholder", name: "Bo Placeholder" }] })
  })

  test("lists a meeting once it started 2 hours ago", async () => {
    const ids = async (now: number) => ((await list(wisprflow(), now)({ since: SINCE, limit: PAGE.max })) as EventsListResult).events.map((event) => event.external_id)
    expect(await ids(NOW)).not.toContain("w-06")
    expect(await ids(Date.parse("2026-10-25T11:00:00Z") + SETTLE_MS)).toContain("w-06")
  })

  test("reads search_meetings a week at a time with UTC bounds, 200 a page, and never contacts", async () => {
    const fake = wisprflow()
    await list(fake)({ since: SINCE, limit: PAGE.max })
    expect(fake.calls[0]).toEqual({ since: "2026-09-28T00:00:00.000Z", until: "2026-10-05T00:00:01.000Z", limit: 200 })
    expect(fake.calls.some((call) => typeof call.cursor === "string")).toBe(true)
    for (const call of fake.calls) expect(Object.keys(call).filter((key) => !["since", "until", "limit", "cursor"].includes(key))).toEqual([])
  })

  test("names its source, account and owner on an empty first page, without a read", async () => {
    const fake = wisprflow()
    expect(await list(fake)({ since: "2999-01-01" })).toMatchObject({ source: "wisprflow", account: "default", owner: OWNER, events: [], more: false })
    expect(fake.calls).toEqual([])
  })

  test("refuses another sign-in's cursor and another account with ACCOUNT_MISMATCH, before any read", async () => {
    const first = (await list()({ since: SINCE, limit: 1 })) as EventsListResult
    const fake = wisprflow()
    expect(await code(list(fake, NOW, { id: "wisprflow:credential:other", label: "Other" })({ account: ACCOUNT, cursor: first.cursor }))).toBe("ACCOUNT_MISMATCH")
    expect(await code(list(fake)({ account: "work" }))).toBe("ACCOUNT_MISMATCH")
    expect(await code(list(fake)({ account: "work", cursor: first.cursor }))).toBe("ACCOUNT_MISMATCH")
    expect(fake.calls).toEqual([])
  })

  test("refuses a cursor it did not issue, an earlier version's included, and one passed without its account, before any read", async () => {
    const first = (await list()({ since: SINCE, limit: 1 })) as EventsListResult
    const fake = wisprflow()
    const refused = (cursor: string) => code(list(fake)({ account: ACCOUNT, cursor }))
    expect(await refused("not-a-cursor")).toBe("CURSOR_INVALID")
    expect(await refused(encodeBoundCursor({ ...BINDING, plugin: "granola" }, { o: "0123456789abcdef", t: 0, i: "" }))).toBe("CURSOR_INVALID")
    expect(await refused(encodeBoundCursor({ ...BINDING, source: "meetings" }, { o: "0123456789abcdef", t: 0, i: "" }))).toBe("CURSOR_INVALID")
    expect(await refused(encodeBoundCursor(BINDING, { o: "not-a-digest", t: 0, i: "" }))).toBe("CURSOR_INVALID")
    expect(await refused(encodeBoundCursor(BINDING, { o: "0123456789abcdef", t: "soon", i: "" }))).toBe("CURSOR_INVALID")
    expect(await refused(encodeCursor(SOURCE, { a: ACCOUNT, o: "0123456789abcdef", t: 0, i: "" }))).toBe("CURSOR_INVALID")
    expect(await code(list(fake)({ cursor: first.cursor }))).toBe("INPUT_INVALID")
    expect(fake.calls).toEqual([])
  })

  test("refuses another source, a malformed input, a scope, and a listing with no sign-in", async () => {
    expect(await code(list()({ source: "granola" }))).toBe("SOURCE_UNKNOWN")
    expect(await code(list()({ limit: 0 }))).toBe("INPUT_INVALID")
    expect(await code(list()({ scope: { folders: ["x"] } }))).toBe("INPUT_INVALID")
    expect(await code(listEvents(wisprflow().search, undefined, {}, NOW))).toBe("NEEDS_SIGN_IN")
  })

  test("keeps two sign-ins' overlapping listings apart: each page is its own owner's, and a cursor never crosses", async () => {
    const other = { id: "wisprflow:credential:cred-2", label: "Wispr Flow" }
    const [mine, theirs] = (await Promise.all([list()({ since: SINCE, limit: 2 }), list(wisprflow(), NOW, other)({ since: SINCE, limit: 2 })])) as EventsListResult[]
    expect(mine!.owner).toEqual(OWNER)
    expect(theirs!.owner).toEqual(other)
    const [next, crossed] = await Promise.all([list()({ account: ACCOUNT, cursor: mine!.cursor, limit: 2 }), code(list(wisprflow(), NOW, other)({ account: ACCOUNT, cursor: mine!.cursor }))])
    expect((next as EventsListResult).events.map((event) => event.external_id)).toEqual(EXPECTED.slice(2, 4))
    expect(crossed).toBe("ACCOUNT_MISMATCH")
  })

  test("splits a window Wispr Flow caps and reads each half again, so the cap loses nothing", async () => {
    // A synthetic Wispr Flow that caps any window holding more than 3 meetings, as the live one caps at 1000.
    const fake = wisprflow(2)
    const capped = async (input: Record<string, unknown>) => {
      const answer = (await fake.search(input)) as Record<string, unknown>
      const since = Date.parse(String(input.since))
      const until = Date.parse(String(input.until))
      const inWindow = MEETINGS.filter((meeting) => Date.parse(meeting.start_time) >= since && Date.parse(meeting.start_time) < until).length
      return inWindow > 3 ? { meetings: [], has_more: false, truncated: true } : answer
    }
    const result = (await listEvents(capped, OWNER, { since: SINCE, limit: PAGE.max }, NOW)) as EventsListResult
    expect(result.events.map((event) => event.external_id)).toEqual(EXPECTED)
    expect(result.gap).toBeUndefined()
  })

  test("stops with UNAVAILABLE only when Wispr Flow caps one minute, and never tells the caller to skip ahead", async () => {
    const failure = await listEvents(async () => ({ meetings: [], has_more: false, truncated: true }), OWNER, { since: SINCE }, NOW).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(EventsFailure)
    expect((failure as EventsFailure).code).toBe("UNAVAILABLE")
    expect((failure as EventsFailure).next).toContain("the same cursor")
  })

  test("answers a gap once for a read that starts before the 30 days the free plan shows, and lists from there", async () => {
    const old = encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: NOW - VISIBLE_MS - 10 * 86_400_000, i: "" })
    const fake = wisprflow(2, [...MEETINGS, { id: "w-00", title: "Locked on the free plan", start_time: new Date(NOW - VISIBLE_MS - 86_400_000).toISOString(), attendees: [] }])
    const first = (await list(fake)({ account: ACCOUNT, cursor: old, limit: 2 })) as EventsListResult
    expect(resultProblems(first, 2, MAX_BYTES)).toEqual([])
    expect(first.gap).toEqual({ reason: "expired", since: new Date(NOW - VISIBLE_MS - 10 * 86_400_000).toISOString() })
    expect(first.events.map((event) => event.external_id)).toEqual(EXPECTED.slice(0, 2))
    expect(Math.min(...fake.calls.map((call) => Date.parse(String(call.since))))).toBeGreaterThanOrEqual(NOW - VISIBLE_MS - 1000)
    expect(first.more).toBe(true)
    const second = (await list(fake)({ account: ACCOUNT, cursor: first.cursor, limit: 2 })) as EventsListResult
    expect(second.gap).toBeUndefined()
    expect(second.events.map((event) => event.external_id)).toEqual(EXPECTED.slice(2, 4))
    // A first listing from a since before the window answers the same gap; one inside it answers none.
    expect(((await list()({ since: "2026-08-01" })) as EventsListResult).gap).toEqual({ reason: "expired", since: "2026-08-01T00:00:00.000Z" })
    expect(((await list()({ since: SINCE })) as EventsListResult).gap).toBeUndefined()
  })

  test("is allowed by the default rules, and so is probe, at every access", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      for (const action of [EVENTS_ACTION, PROBE_ACTION]) expect(evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules(access)], action)).toBe("allow")
    }
    expect(EVENTS_INPUT.properties.cursor.maxLength).toBe(EVENT_LIMITS.cursor)
    expect([EVENTS_INPUT.properties.limit.minimum, EVENTS_INPUT.properties.limit.maximum]).toEqual([PAGE.min, PAGE.max])
  })
})

/** A plugin context with OpenCode's sign-in for wisprflow and its search_meetings executor. */
function context(label = "Ada@Example.test", search = wisprflow().search) {
  const asserted: Record<string, unknown>[] = []
  const ctx = {
    tool: {
      list: async () => [{ id: "wisprflow_search_meetings", execute: async (input: Record<string, unknown>) => ({ output: await search(input) }) }],
    },
    mcp: { list: async () => ({ data: [{ name: "wisprflow", integrationID: "int-1", status: { status: "connected" } }] }) },
    permission: { assert: async (request: Record<string, unknown>) => void asserted.push(request), hook: async () => ({ dispose: async () => undefined }) },
    integration: { connection: { active: async () => ({ type: "credential", id: "cred-1", label }) } },
  }
  return { ctx: ctx as unknown as EventsContext, asserted }
}

describe("the owner", () => {
  test("is always the sign-in's credential id, with its label for display only, an email label included", async () => {
    expect(await signedIn(context().ctx)).toEqual(OWNER)
    expect(await signedIn(context("Wispr Flow").ctx)).toEqual({ id: "wisprflow:credential:cred-1", label: "Wispr Flow" })
    expect(await signedIn(context("").ctx)).toEqual({ id: "wisprflow:credential:cred-1", label: "Wispr Flow sign-in" })
    const none = { mcp: { list: async () => ({ data: [{ name: "wisprflow", status: { status: "connected" } }] }) }, integration: { connection: { active: async () => undefined } } }
    expect(await signedIn(none as never)).toBeUndefined()
  })

  test("renaming the sign-in's label keeps the owner's id, so a cursor still reads", async () => {
    const first = (await list(wisprflow(), NOW, (await signedIn(context("Ada@Example.test").ctx))!)({ since: SINCE, limit: 1 })) as EventsListResult
    const renamed = (await signedIn(context("Work account").ctx))!
    expect(renamed.id).toBe(OWNER.id)
    const next = (await list(wisprflow(), NOW, renamed)({ account: ACCOUNT, cursor: first.cursor, limit: 1 })) as EventsListResult
    expect(next.events.map((event) => event.external_id)).toEqual(EXPECTED.slice(1, 2))
  })
})

describe("probe", () => {
  test("names OpenCode's sign-in as the owner every page names, and reads nothing", async () => {
    const page = (await list()({ since: SINCE, limit: 1 })) as EventsListResult
    const result = wisprflowProbe(OWNER, {})
    expect(probeResultProblems(result, { source: SOURCE, account: ACCOUNT })).toEqual([])
    expect(result).toEqual({ source: SOURCE, account: ACCOUNT, owner: page.owner, trust: "untrusted" })
  })

  test("refuses another account, another source, a malformed input and no sign-in", async () => {
    expect(await code(Promise.resolve().then(() => wisprflowProbe(OWNER, { account: "work" })))).toBe("ACCOUNT_MISMATCH")
    expect(await code(Promise.resolve().then(() => wisprflowProbe(OWNER, { source: "granola" })))).toBe("SOURCE_UNKNOWN")
    expect(await code(Promise.resolve().then(() => wisprflowProbe(OWNER, { since: SINCE })))).toBe("INPUT_INVALID")
    expect(await code(Promise.resolve().then(() => wisprflowProbe(undefined, {})))).toBe("NEEDS_SIGN_IN")
  })
})

describe("the tools RPC's events_list and probe", () => {
  async function rpc(managed = true) {
    const { ctx, asserted } = context()
    let handlers: Record<string, (input: unknown, context: unknown) => Promise<unknown>> = {}
    const host = {
      ...ctx,
      location: { directory: "/fixture/project" },
      rpc: { register: async (_contract: unknown, registered: typeof handlers) => ((handlers = registered), { dispose: async () => undefined }) },
      session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, agent: "build", location: { directory: "/fixture/project" } }) },
      agent: { get: async () => ({ data: { permissions: [{ action: "*", resource: "*", effect: "allow" }, ...defaultRules()] } }) },
    }
    await registerToolsRpc(host as never, { plugin: PLUGIN, methods: [eventsMethod(ctx, () => managed, () => NOW), probeMethod(ctx, () => managed)], mcp: { server: "wisprflow", managed: () => managed } })
    const rpcContext = { signal: new AbortController().signal, error: (type: string, message: string, data?: unknown) => ({ type, message, data }) }
    return {
      asserted,
      run: (input: unknown) => handlers.events_list!({ sessionID: "ses_1", input }, rpcContext),
      probe: (input: unknown) => handlers.probe!({ sessionID: "ses_1", input }, rpcContext),
    }
  }

  test("asserts wisprflow_events_list, reads through search_meetings and keeps the contract", async () => {
    const { run, asserted } = await rpc()
    const list = async (input: unknown) => {
      const result = (await run(input)) as Record<string, unknown>
      if (result.type === "failed") throw new Error(String(result.message))
      return result
    }
    await assertEventsListConformance(list, { source: SOURCE, account: ACCOUNT, owner: OWNER, since: SINCE, expected: EXPECTED, binding: { plugin: "wisprflow" }, codes: true, maxBytes: MAX_BYTES })
    expect(asserted.every((request) => request.action === EVENTS_ACTION)).toBe(true)
  })

  test("probe asserts wisprflow_probe alone and answers the sign-in", async () => {
    const { probe, asserted } = await rpc()
    expect(await probe({})).toEqual({ source: SOURCE, account: ACCOUNT, owner: OWNER, trust: "untrusted" })
    expect(asserted.map((request) => request.action)).toEqual([PROBE_ACTION])
    expect(await probe({ account: "work" })).toMatchObject({ type: "failed", data: { code: "ACCOUNT_MISMATCH" } })
    expect(await (await rpc(false)).probe({})).toMatchObject({ type: "failed", data: { code: "UNAVAILABLE" } })
  })

  test("gives a script its code and next step, and refuses beside someone else's wisprflow server", async () => {
    expect(await (await rpc()).run({ account: ACCOUNT, cursor: "not-a-cursor" })).toMatchObject({ type: "failed", data: { code: "CURSOR_INVALID", next: expect.stringContaining("since") } })
    expect(await (await rpc(false)).run({})).toMatchObject({ type: "failed", data: { code: "UNAVAILABLE" } })
  })
})
