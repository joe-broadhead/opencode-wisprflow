// The meetings page and its cursor, against the synthetic Wispr Flow in test/support/fake.ts: the contract's own
// consumer check accepts every page, and the boundaries (settle, the 30-day window, caps, look-back) behave as the
// module documents.
import assert from "node:assert/strict"
import { test } from "node:test"
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"
import { EVENT_LIMITS, resultProblems, SourceError, type EventsListResult, type EventsOwner } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest, packageName } from "../../src/manifest.ts"
import {
  listEvents,
  meetingsList,
  readMeetingsPage,
  resultData,
  MAX_BYTES,
  SETTLE_MS,
  SOURCE,
  VISIBLE_MS,
} from "../../src/provider/meetings.ts"
import { capped, DAY, digestOf, EXPECTED, MEETINGS, NOW, PERSONAL, SECRET, SINCE, wisprflow, type Meeting } from "../support/fake.ts"

const SOURCE_ITEM = findSource(manifest, "wisprflow.meetings")
if (SOURCE_ITEM === undefined) throw new Error("the manifest declares no wisprflow.meetings source")
const OWNER: EventsOwner = { id: "wisprflow:credential:cred-work", label: "Wispr Flow (work)", verified: false }
const BINDING = { plugin: "wisprflow", source: SOURCE, account: "work" }
const ACCOUNT = "work"

/** Every page the tests answer is checked with the consumer's own call, not a copy of its rules. */
function accepted(page: EventsListResult, account = ACCOUNT) {
  assert.ok(SOURCE_ITEM !== undefined)
  const acceptedPage = acceptAnswer(SOURCE_ITEM, account, page)
  if (!acceptedPage.ok) throw new Error(acceptedPage.failure.message)
  return page
}

const list = (fake = wisprflow(), now = NOW, owner: EventsOwner = OWNER, account = ACCOUNT) => (input: unknown) =>
  listEvents(fake.search, owner, account, packageName, input, now).then((page) => accepted(page, account))

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof SourceError ? error.code : String(error)
  }
}

test("the meetings list sorts newest first before the cap", async () => {
  const search = async () => ({ meetings: [...MEETINGS].reverse().map((meeting) => ({ ...meeting, end_time: meeting.start_time, folders: null })), has_more: false })
  const answer = await meetingsList(search, ACCOUNT, { source: SOURCE, list: "meetings" }, NOW)
  assert.deepEqual(answer.data.items.slice(0, 2).map((item) => item.id), ["w-06", "w-05"])
})

test("the meetings list screens the whole title before the cut, and lists an id once", async () => {
  // Invented credential for the list-screening test; assembled so no credential-shaped literal is committed.
  const SECRET_TOKEN = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_")
  const straddling = { id: "w-cut", title: `${"x".repeat(199)} ${SECRET_TOKEN}`, start_time: "2026-11-20T10:00:00Z", attendees: [] }
  const duplicate = { id: "w-dup", title: "Once", start_time: "2026-11-21T10:00:00Z", attendees: [] }
  const search = async () => ({ meetings: [straddling, duplicate, duplicate].map((meeting) => ({ ...meeting, end_time: meeting.start_time, folders: null })), has_more: false })
  const answer = await meetingsList(search, ACCOUNT, { source: SOURCE, list: "meetings" }, NOW)
  assert.deepEqual(answer.data.items, [{ id: "w-dup", text: "Once" }])
})

test("the meetings list refuses a cursor, a since, a limit or a scope, and an unknown source", async () => {
  const search = wisprflow().search
  assert.equal(await code(meetingsList(search, ACCOUNT, { source: SOURCE, list: "meetings", cursor: "x" }, NOW)), "INPUT_INVALID")
  assert.equal(await code(meetingsList(search, ACCOUNT, { source: SOURCE, list: "meetings", since: SINCE }, NOW)), "INPUT_INVALID")
  assert.equal(await code(meetingsList(search, ACCOUNT, { source: SOURCE, list: "meetings", scope: { folders: ["secret"] } }, NOW)), "INPUT_INVALID")
  assert.equal(await code(meetingsList(search, ACCOUNT, { source: "other", list: "meetings" }, NOW)), "SOURCE_UNKNOWN")
})

test("reads meetings, their attendees, owner, share_link and flags, and the cursor only while has_more", () => {
  const page = readMeetingsPage({
    meetings: [
      {
        id: "m",
        title: "T",
        start_time: "2026-11-01T09:00:00Z",
        attendees: [{ name: "Ada", email: "ADA@example.test" }, "lin@example.test", { name: "" }],
        share_link: "https://notes.wisprflow.ai/shared/m",
        shared: true,
        owner: { name: "Bo" },
        has_transcript: true,
        summary: "A summary.",
      },
    ],
    has_more: true,
    next_cursor: "c1",
  })
  assert.deepEqual(page, {
    meetings: [
      {
        id: "m",
        title: "T",
        time: Date.parse("2026-11-01T09:00:00Z"),
        url: "https://notes.wisprflow.ai/shared/m",
        attendees: [{ name: "Ada", email: "ada@example.test" }, { email: "lin@example.test" }],
        owner: { name: "Bo" },
        shared: true,
        transcript: true,
        summary: "A summary.",
      },
    ],
    next: "c1",
    more: true,
    truncated: false,
  })
  const schemaError = (value: unknown) =>
    assert.throws(
      () => readMeetingsPage(value),
      (error: unknown) => error instanceof SourceError && error.code === "SCHEMA_VIOLATION" && error.message.includes("Next step: "),
    )
  schemaError("not json")
  schemaError({})
  schemaError({ meetings: [], has_more: true })
  schemaError({ meetings: "not a list" })
  schemaError({ meetings: [{ id: "x", start_time: "Oct 1" }] })
  schemaError({ meetings: [{ title: "no id" }] })
  schemaError({ meetings: [null] })
})

test("a tool result's data is its structured output, or its text parsed as JSON", () => {
  assert.deepEqual(resultData({ output: { meetings: [] } }), { meetings: [] })
  assert.deepEqual(resultData({ content: [{ type: "text", text: '{"meetings":[1]}' }] }), { meetings: [1] })
  assert.equal(resultData({ content: [{ type: "text", text: "plain" }] }), "plain")
})

test("each meeting is one event: attendees and a shared meeting's owner as actors, its share link and labels", async () => {
  const page = await list()({ since: SINCE, limit: 500 })
  assert.equal(resultProblems(page, 500, MAX_BYTES).length, 0)
  assert.deepEqual({ source: page.source, account: page.account, owner: page.owner, more: page.more, trust: page.trust }, { source: SOURCE, account: ACCOUNT, owner: OWNER, more: false, trust: "untrusted" })
  assert.equal(page.refused, undefined)
  assert.equal(page.plugin, packageName)
  assert.equal(page.asOf, new Date(NOW).toISOString())
  const first = page.events[0]
  const second = page.events[1]
  assert.ok(first !== undefined)
  assert.ok(second !== undefined)
  assert.deepEqual(
    (({ external_id, kind, occurred_at, thread, title, text, url, labels, actors }) => ({ external_id, kind, occurred_at, thread, title, text, url, labels, actors }))(first),
    {
      external_id: "w-01",
      kind: "meeting",
      occurred_at: "2026-11-01T09:00:00.000Z",
      thread: null,
      title: "Kickoff",
      text: "The kickoff summary.",
      url: "https://notes.wisprflow.ai/shared/w-01",
      labels: ["transcript"],
      actors: [
        { role: "attendee", id: "mailto:ada@example.test", name: "Ada Example" },
        { role: "attendee", id: "name:Lin%20Sample", name: "Lin Sample" },
      ],
    },
  )
  assert.deepEqual({ external_id: second.external_id, url: second.url, labels: second.labels, actors: second.actors }, {
    external_id: "w-02",
    url: null,
    labels: ["shared"],
    actors: [{ role: "owner", id: "name:Bo%20Placeholder", name: "Bo Placeholder" }],
  })
})

test("a meeting is listed once it started 2 hours ago", async () => {
  const ids = async (now: number) => (await list(wisprflow(), now)({ since: SINCE, limit: 500 })).events.map((event) => event.external_id)
  assert.ok(!(await ids(NOW)).includes("w-06"))
  assert.ok((await ids(Date.parse("2026-11-25T08:00:00Z") + SETTLE_MS)).includes("w-06"))
})

test("search_meetings is read a week at a time with UTC bounds, 200 a page, and nothing else", async () => {
  const fake = wisprflow()
  await list(fake)({ since: SINCE, limit: 500 })
  assert.deepEqual(fake.calls[0], { since: "2026-11-01T00:00:00.000Z", until: "2026-11-08T00:00:01.000Z", limit: 200 })
  assert.ok(fake.calls.some((call) => typeof call.cursor === "string"))
  for (const call of fake.calls) assert.deepEqual(Object.keys(call).filter((key) => !["since", "until", "limit", "cursor"].includes(key)), [])
})

test("an empty first page names its source, account and owner without a read", async () => {
  const fake = wisprflow()
  const page = await list(fake)({ since: "2999-01-01" })
  assert.deepEqual({ source: page.source, account: page.account, owner: page.owner, events: page.events, more: page.more }, { source: SOURCE, account: ACCOUNT, owner: OWNER, events: [], more: false })
  assert.deepEqual(fake.calls, [])
})

test("another sign-in's cursor is ACCOUNT_MISMATCH, and another account's is CURSOR_INVALID, before any read", async () => {
  const first = await list()({ since: SINCE, limit: 1 })
  const fake = wisprflow()
  const other: EventsOwner = { id: "wisprflow:credential:other", label: "Other", verified: false }
  assert.equal(await code(list(fake, NOW, other)({ cursor: first.cursor })), "ACCOUNT_MISMATCH")
  assert.equal(await code(list(fake, NOW, OWNER, "personal")({ cursor: first.cursor })), "CURSOR_INVALID")
  assert.deepEqual(fake.calls, [])
})

test("a cursor this source did not issue, from another format or another plugin, is CURSOR_INVALID", async () => {
  const first = await list()({ since: SINCE, limit: 1 })
  const fake = wisprflow()
  const refused = (cursor: string) => code(list(fake)({ cursor }))
  assert.equal(await refused("not-a-cursor"), "CURSOR_INVALID")
  assert.equal(await refused(encodeBoundCursor({ ...BINDING, plugin: "another-plugin" }, { o: digestOf(OWNER.id), t: 0, i: "" })), "CURSOR_INVALID")
  assert.equal(await refused(encodeBoundCursor({ ...BINDING, source: "meetings" }, { o: digestOf(OWNER.id), t: 0, i: "" })), "CURSOR_INVALID")
  assert.equal(await refused(encodeBoundCursor(BINDING, { o: "not-a-digest", t: 0, i: "" })), "CURSOR_INVALID")
  assert.equal(await refused(encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: "soon", i: "" })), "CURSOR_INVALID")
  assert.deepEqual(fake.calls, [])
  assert.ok(first.cursor.length > 0)
})

test("an unknown source, a malformed input and a scope are refused", async () => {
  assert.equal(await code(list()({ source: "another-source" })), "SOURCE_UNKNOWN")
  assert.equal(await code(list()({ limit: 0 })), "INPUT_INVALID")
  assert.equal(await code(list()({ scope: { folders: ["x"] } })), "INPUT_INVALID")
})

test("two sign-ins' overlapping listings stay apart: each page is its own owner's, and a cursor never crosses", async () => {
  const other: EventsOwner = { id: "wisprflow:credential:cred-personal", label: "Wispr Flow (personal)", verified: false }
  const [mine, theirs] = await Promise.all([list()({ since: SINCE, limit: 2 }), list(wisprflow(2, PERSONAL), NOW, other, "personal")({ since: SINCE, limit: 2 })])
  assert.deepEqual(mine.owner, OWNER)
  assert.deepEqual(theirs.owner, other)
  assert.deepEqual(theirs.events.map((event) => event.external_id), ["p-01"])
  const [next, crossed] = await Promise.all([list()({ cursor: mine.cursor, limit: 2 }), code(list(wisprflow(), NOW, other, "personal")({ cursor: mine.cursor }))])
  assert.deepEqual(next.events.map((event) => event.external_id), EXPECTED.slice(2, 4))
  assert.equal(crossed, "CURSOR_INVALID")
})

test("a page boundary between two meetings at the same start lists the second by id, without a repeat", async () => {
  const tie = Date.parse("2026-11-10T08:00:00Z")
  const same = [
    // The provider lists the larger id first; the plugin's page order is the total order, so tie-a is page one.
    { id: "tie-b", title: "Tie B", start_time: new Date(tie).toISOString(), attendees: [] },
    { id: "tie-a", title: "Tie A", start_time: new Date(tie).toISOString(), attendees: [] },
  ]
  const fake = wisprflow(1, same)
  const first = await list(fake)({ since: "2026-11-10", limit: 1 })
  assert.deepEqual(first.events.map((event) => event.external_id), ["tie-a"])
  assert.equal(first.more, true)
  // The cursor is the total order (start, id): it resumes strictly after tie-a's pair, not after its timestamp.
  const decoded = decodeBoundCursor(BINDING, first.cursor)
  assert.equal(decoded.ok, true)
  if (decoded.ok) assert.deepEqual({ t: decoded.state.t, i: decoded.state.i }, { t: tie, i: "tie-a" })
  const second = await list(fake)({ cursor: first.cursor, limit: 1 })
  assert.deepEqual(second.events.map((event) => event.external_id), ["tie-b"])
  const third = await list(fake)({ cursor: second.cursor, limit: 1 })
  assert.deepEqual(third.events, [])
  assert.equal(third.more, false)
})

test("since with limit 1, paged to the end, lists every matching meeting exactly once", async () => {
  const fake = wisprflow(1)
  const listed: string[] = []
  let page = await list(fake)({ since: SINCE, limit: 1 })
  for (let calls = 0; ; calls++) {
    listed.push(...page.events.map((event) => event.external_id))
    assert.ok(calls < 20, "the read did not finish")
    if (!page.more) break
    // The next page carries only the cursor; the read's `since` floor and the (start, id) position travel in it.
    page = await list(fake)({ cursor: page.cursor, limit: 1 })
  }
  assert.deepEqual(listed, EXPECTED)
  assert.equal(new Set(listed).size, listed.length)
})

test("a meeting whose title holds a secret is refused for good, and the cursor moves past it", async () => {
  const page = await list(wisprflow(2, [...MEETINGS, SECRET]))({ since: SINCE, limit: 500 })
  assert.deepEqual(page.refused, [{ external_id: SECRET.id, reason: "secret", detail: "holds a secret (connection string)" }])
  assert.ok(!JSON.stringify(page).includes("Hb3nQ8vTk2"))
})

test("a window the provider caps is split and read again, so the cap loses nothing", async () => {
  const fake = wisprflow(2)
  const capSearch = async (input: Record<string, unknown>) => {
    const answer = (await fake.search(input)) as Record<string, unknown>
    const since = Date.parse(String(input.since))
    const until = Date.parse(String(input.until))
    const inWindow = MEETINGS.filter((meeting) => Date.parse(meeting.start_time) >= since && Date.parse(meeting.start_time) < until).length
    return inWindow > 3 ? { meetings: [], has_more: false, truncated: true } : answer
  }
  const page = await listEvents(capSearch, OWNER, ACCOUNT, packageName, { since: SINCE, limit: 500 }, NOW)
  assert.deepEqual(page.events.map((event) => event.external_id), EXPECTED)
  assert.equal(page.gap, undefined)
})

test("a minute the provider still caps is answered as a gap once, and the cursor moves past it", async () => {
  const burst = Date.parse("2026-11-20T09:00:00Z")
  const meetings: Meeting[] = [
    { id: "before", title: "Before", start_time: "2026-11-19T09:00:00Z" },
    ...Array.from({ length: 1001 }, (_, index) => ({ id: `burst-${String(index).padStart(4, "0")}`, title: "Burst", start_time: new Date(burst).toISOString() })),
    { id: "after", title: "After", start_time: "2026-11-22T09:00:00Z" },
  ]
  const fake = capped(meetings)
  const call = (input: unknown) => listEvents(fake.search, OWNER, ACCOUNT, packageName, input, NOW)
  const first = await call({ since: "2026-11-18", limit: 10 })
  assert.deepEqual(first.events.map((event) => event.external_id), ["before"])
  assert.equal(first.gap, undefined)
  assert.equal(first.more, true)
  const second = await call({ cursor: first.cursor, limit: 10 })
  assert.equal(resultProblems(second, 10, MAX_BYTES).length, 0)
  assert.equal(second.gap?.reason, "window-truncated")
  assert.ok(burst - Date.parse(second.gap?.since) >= 0)
  assert.ok(burst - Date.parse(second.gap?.since) < 60_000)
  assert.deepEqual(second.events.map((event) => event.external_id), ["after"])
  const third = await call({ cursor: second.cursor, limit: 10 })
  assert.equal(third.gap, undefined)
  assert.deepEqual(third.events, [])
  assert.equal(third.more, false)
})

test("a later page of a read that answered its gap answers none, even read minutes or hours later", async () => {
  const line = NOW - VISIBLE_MS + DAY
  const fake = wisprflow(1, [
    { id: "edge-a", title: "A", start_time: new Date(line + 60_000).toISOString() },
    { id: "edge-b", title: "B", start_time: new Date(line + 90_000).toISOString() },
    { id: "new-10", title: "C", start_time: new Date(NOW - 10 * DAY).toISOString() },
  ])
  const old = encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: NOW - 45 * DAY, i: "", f: NOW - 45 * DAY + 1, r: "" })
  const first = await list(fake)({ cursor: old, limit: 1 })
  assert.equal(first.gap?.reason, "expired")
  assert.deepEqual(first.events.map((event) => event.external_id), ["edge-a"])
  const second = await list(fake, NOW + 2 * 60_000)({ cursor: first.cursor, limit: 1 })
  assert.equal(second.gap, undefined)
  assert.deepEqual(second.events.map((event) => event.external_id), ["edge-b"])
  const third = await list(fake, NOW + 20 * 3_600_000)({ cursor: second.cursor, limit: 1 })
  assert.equal(third.gap, undefined)
  assert.deepEqual(third.events.map((event) => event.external_id), ["new-10"])
  const paused = await list(fake, NOW + 2 * DAY)({ cursor: second.cursor, limit: 1 })
  assert.equal(paused.gap?.reason, "expired")
})

test("a read gaps a day inside the 30-day window, so a meeting near the lock is never lost silently", async () => {
  const at = (age: number) => encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: NOW - age, i: "", f: NOW - age + 1, r: "" })
  assert.equal((await list()({ cursor: at(29 * DAY + 3_600_000) })).gap?.reason, "expired")
  assert.equal((await list()({ cursor: at(29 * DAY - 3_600_000) })).gap, undefined)
  assert.equal((await list()({ since: new Date(NOW - 29 * DAY - 60_000).toISOString() })).gap?.reason, "expired")
})

test("a late meeting that shares a start with one just listed is kept behind a full tag set", async () => {
  const t0 = NOW - 6 * DAY
  const meetings: Meeting[] = Array.from({ length: 48 }, (_, index) => ({ id: `k-${String(index).padStart(2, "0")}`, title: "K", start_time: new Date(t0 + index * 2 * 3_600_000).toISOString() }))
  const fake = capped(meetings)
  const first = await listEvents(fake.search, OWNER, ACCOUNT, packageName, { since: new Date(t0 - DAY).toISOString(), limit: 500 }, NOW)
  assert.equal(first.events.length, 48)
  const tie = new Date(t0 - 12 * 3_600_000).toISOString()
  meetings.push({ id: "late-1", title: "Late", start_time: tie }, { id: "late-2", title: "Late", start_time: tie }, { id: "late-3", title: "Late", start_time: tie })
  const listed: string[] = []
  let page = first
  for (let call = 0; call < 6; call++) {
    page = await listEvents(fake.search, OWNER, ACCOUNT, packageName, { cursor: page.cursor, limit: 1 }, NOW)
    assert.ok(page.cursor.length <= EVENT_LIMITS.cursor)
    listed.push(...page.events.map((event) => event.external_id))
    if (!page.more) break
  }
  assert.deepEqual(listed, ["late-1", "late-2", "late-3"])
})

test("a read that starts before the 30 days the free plan shows answers one gap and lists from there", async () => {
  const old = encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: NOW - VISIBLE_MS - 10 * DAY, i: "", f: NOW - VISIBLE_MS - 10 * DAY + 1, r: "" })
  const fake = wisprflow(2, [...MEETINGS, { id: "w-00", title: "Locked on the free plan", start_time: new Date(NOW - VISIBLE_MS - DAY).toISOString(), attendees: [] }])
  const first = await list(fake)({ cursor: old, limit: 2 })
  assert.equal(resultProblems(first, 2, MAX_BYTES).length, 0)
  assert.deepEqual(first.gap, { reason: "expired", since: new Date(NOW - VISIBLE_MS - 10 * DAY).toISOString() })
  assert.deepEqual(first.events.map((event) => event.external_id), EXPECTED.slice(0, 2))
  assert.ok(Math.min(...fake.calls.map((call) => Date.parse(String(call.since)))) >= NOW - VISIBLE_MS - 1000)
  assert.equal(first.more, true)
  const second = await list(fake)({ cursor: first.cursor, limit: 2 })
  assert.equal(second.gap, undefined)
  assert.deepEqual(second.events.map((event) => event.external_id), EXPECTED.slice(2, 4))
  assert.deepEqual((await list()({ since: "2026-08-01" })).gap, { reason: "expired", since: "2026-08-01T00:00:00.000Z" })
  assert.equal((await list()({ since: SINCE })).gap, undefined)
})

test("a meeting that reached the provider after the cursor passed it is listed once, and nothing twice", async () => {
  const meetings: Meeting[] = [...MEETINGS]
  const fake = wisprflow(2, meetings)
  const first = await list(fake)({ since: SINCE, limit: 500 })
  assert.deepEqual(first.events.map((event) => event.external_id), EXPECTED)
  meetings.push({ id: "w-late", title: "Uploaded late", start_time: new Date(NOW - DAY).toISOString(), attendees: [] })
  const second = await list(fake)({ cursor: first.cursor, limit: 500 })
  assert.equal(resultProblems(second, 500, MAX_BYTES).length, 0)
  assert.deepEqual(second.events.map((event) => event.external_id), ["w-late"])
  const third = await list(fake)({ cursor: second.cursor, limit: 500 })
  assert.deepEqual(third.events, [])
  assert.equal(third.more, false)
})

test("a cursor without the look-back fields, or with a malformed one, is CURSOR_INVALID", async () => {
  const fake = wisprflow()
  const old = encodeBoundCursor(BINDING, { o: digestOf(OWNER.id), t: Date.parse("2026-11-09T08:00:00Z"), i: "w-03a" })
  assert.equal(await code(list(fake)({ cursor: old })), "CURSOR_INVALID")
  const state = { o: digestOf(OWNER.id), t: Date.parse(SINCE), i: "" }
  for (const extra of [{ f: "soon", r: "" }, { f: 0, r: "short" }, { f: 0, r: "!!!!!!!!" }, { f: state.t + 2, r: "" }, { r: "" }, { f: 0, r: "", g: "soon" }, { f: 0, r: "", g: state.t + 2 }]) {
    assert.equal(await code(list(fake)({ cursor: encodeBoundCursor(BINDING, { ...state, ...extra }) })), "CURSOR_INVALID")
  }
  assert.deepEqual(fake.calls, [])
})

test("the cursor stays small with many meetings behind it, and still lists each once", async () => {
  const busy: Meeting[] = Array.from({ length: 120 }, (_, index) => ({ id: `b-${String(index).padStart(3, "0")}`, title: "Busy", start_time: new Date(Date.parse("2026-11-20T00:00:00Z") + index * 3_600_000).toISOString() }))
  const fake = wisprflow(50, busy)
  const listed: string[] = []
  let cursor: string | undefined
  for (let call = 0; call < 10; call++) {
    const page = await list(fake)(cursor === undefined ? { since: "2026-11-19", limit: 40 } : { cursor, limit: 40 })
    assert.ok(page.cursor.length <= EVENT_LIMITS.cursor)
    listed.push(...page.events.map((event) => event.external_id))
    cursor = page.cursor
    if (!page.more) break
  }
  const settled = busy.filter((meeting) => Date.parse(meeting.start_time) <= NOW - SETTLE_MS).map((meeting) => meeting.id)
  assert.deepEqual(listed, settled)
})
