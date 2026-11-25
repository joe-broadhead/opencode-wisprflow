/**
 * The meetings source: Wispr Flow's Notetaker meetings as contract events.
 *
 * `events_list` lists the meetings Wispr Flow captured since a cursor, oldest first, through the MCP server's own
 * `search_meetings`; `list: "meetings"` answers the same meetings as the registry's `list` snapshot. A meeting is listed
 * once it started `SETTLE_MS` ago, when its notes are most likely done; one whose title or summary holds a secret is
 * refused for good. Nothing here names a host, a credential or a door: `client.ts` does that, and the handler table calls
 * this module through it.
 *
 * History can be lost before a reader sees it: on the free plan, meetings older than 30 days are locked, and no Wispr
 * Flow tool names the plan, so every sign-in is read as if it had that window (`VISIBLE_MS`), with a day's margin
 * (`MARGIN_MS`) for clock skew and the provider's own rounding. A read that starts more than 29 days ago answers a `gap`
 * (`expired`, since where the read started) on its first page and restarts at that line, which the cursor carries (`g`).
 * A week the provider caps (more than 1,000 meetings) is split and read again, so a cap loses nothing; a minute it still
 * caps is a hole: the page before it stops short of it, and the next answers a `gap` (`window-truncated`, since the
 * hole) and moves past it, so the cursor always moves on.
 *
 * A meeting can reach Wispr Flow after the cursor passed its start: processed late, uploaded from a machine that was
 * offline, or shared later. So every read also looks back up to `LOOKBACK_MS` behind the cursor, and the cursor carries a
 * short tag of each meeting it already accounted for there (listed or refused, `MAX_RECENT`, more only to keep a meeting
 * that shares a start with one still waiting, and always within the cursor's 1,024 characters): a meeting in that
 * stretch without a tag is listed once, and none is listed twice.
 */
import { createHash } from "node:crypto"
import { decodeBoundCursor, encodeBoundCursor, type CursorBinding } from "@we-the-rebel-alliance/plugin-contract/cursor"
import {
  eventsListResult,
  fitPage,
  makeEvent,
  parseEventsListInput,
  screenEvents,
  secretKinds,
  startTime,
  SourceError,
  type EventsListResult,
  type EventsOwner,
  type SourceEvent,
} from "@we-the-rebel-alliance/plugin-contract/events"

/** The source's name, as `events_list` takes it and every event names it. */
export const SOURCE = "wisprflow"
/** The most bytes of JSON one page holds: the source's `maxBytes`. */
export const MAX_BYTES = 65_536

/** A meeting is listed once it started this long ago. */
export const SETTLE_MS = 2 * 3_600_000
/** The window every sign-in is read with: the free plan locks meetings older than this. */
export const VISIBLE_MS = 30 * 86_400_000
/** The margin inside that window: a read gaps, and restarts, at 29 days, so meetings near the lock are never lost silently. */
export const MARGIN_MS = 86_400_000
const WINDOW_MS = 7 * 86_400_000
/** How far behind the cursor each read looks for a meeting that reached the provider late. */
export const LOOKBACK_MS = 7 * 86_400_000
/** The most tags a cursor carries; past them the look-back starts after the oldest one dropped. */
const MAX_RECENT = 48
/** A tag's length: base64url characters of the sha256 of the meeting id (48 bits). */
const TAG_LENGTH = 8
/** The most tags a cursor may carry when it decodes; what it carries is bounded by its 1,024 characters. */
const MAX_TAGS = 128
/** The shortest window a cap splits: a minute the provider still caps is a hole the read gaps over. */
const MIN_SPLIT_MS = 60_000
const MAX_WINDOWS = 60
/** `search_meetings`' largest page. */
const PAGE_SIZE = 200
/** The most `search_meetings` pages one window takes before it is split; the provider pages at most 1,000 results per query. */
const MAX_PAGES = 50

const CURSOR_NEXT = "Pass a cursor from a previous result for the same account, or start again with since."

function refuse(code: string, what: string, next: string): never {
  throw new SourceError({ code, what: `${what}.`, next })
}

/** A meeting that started within a searched window. */
export interface Attendee {
  readonly name?: string
  readonly email?: string
}

/** One meeting of a `search_meetings` page. */
export interface MeetingFacts {
  readonly id: string
  readonly title: string
  readonly time: number
  readonly url?: string
  readonly attendees: readonly Attendee[]
  readonly owner?: Attendee
  readonly shared: boolean
  readonly transcript: boolean
  readonly summary?: string
}

export interface MeetingsPage {
  readonly meetings: readonly MeetingFacts[]
  readonly next?: string
  readonly more: boolean
  readonly truncated: boolean
}

/** Runs `search_meetings` for the resolved account and returns its data. */
export type Search = (input: Record<string, unknown>) => Promise<unknown>

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined

/** A tool result's data: its structured output, or its text parsed as JSON. */
export function resultData(result: { readonly output?: unknown; readonly content?: unknown }): unknown {
  if (record(result.output) || Array.isArray(result.output)) return result.output
  const body =
    typeof result.output === "string"
      ? result.output
      : typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
          : ""
  try {
    return JSON.parse(body) as unknown
  } catch {
    return body
  }
}

/** The provider's times are UTC ISO ending in Z, or an offset. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

function timeOf(meeting: Record<string, unknown>): number | undefined {
  for (const key of ["start_time", "started_at", "start", "starts_at", "start_at"]) {
    const value = meeting[key]
    const at = typeof value === "string" ? value.trim() : record(value) ? text(value.date_time ?? value.dateTime) : undefined
    if (at && ISO_UTC.test(at)) {
      const time = Date.parse(at)
      if (Number.isFinite(time)) return time
    }
  }
  return undefined
}

function person(value: unknown): Attendee | undefined {
  if (typeof value === "string") return value.includes("@") ? { email: value.trim().toLowerCase() } : value.trim() ? { name: value.trim() } : undefined
  if (!record(value)) return undefined
  const name = text(value.name) ?? text(value.display_name)
  const email = text(value.email)?.toLowerCase()
  if (!name && !email) return undefined
  return { ...(name ? { name } : {}), ...(email && /^[^\s@]+@[^\s@]+$/.test(email) ? { email } : {}) }
}

const PAGE_NEXT = "Read again with the same cursor; if it keeps failing, update the plugin."

/** A provider answer this plugin cannot read. Missing data is unknown, never an empty page. */
function pageError(what: string): never {
  throw new SourceError({ code: "SCHEMA_VIOLATION", what: `${what}.`, next: PAGE_NEXT })
}

/** A `search_meetings` page: its meetings, the next cursor while `has_more`, and whether the provider capped it. */
export function readMeetingsPage(data: unknown): MeetingsPage {
  if (!record(data) && !Array.isArray(data)) pageError("search_meetings did not answer a page")
  const page = record(data) ? data : {}
  const list = Array.isArray(data) ? data : ["meetings", "results", "items", "data"].map((key) => page[key]).find(Array.isArray)
  if (!Array.isArray(list)) pageError("search_meetings answered no meetings list")
  const meetings: MeetingFacts[] = []
  for (const item of list) {
    if (!record(item)) pageError("search_meetings answered a meeting that is not an object")
    const id = text(item.id) ?? text(item.meeting_id)
    const time = timeOf(item)
    if (!id || time === undefined) pageError("search_meetings answered a meeting without an id and start time")
    const attendees = (["attendees", "participants"].map((key) => item[key]).find(Array.isArray) ?? []) as unknown[]
    const url = text(item.share_link)
    const owner = person(item.owner)
    const summary = text(item.summary)
    meetings.push({
      id,
      title: text(item.title) ?? text(item.name) ?? "",
      time,
      ...(url ? { url } : {}),
      attendees: attendees.flatMap((attendee) => person(attendee) ?? []),
      ...(owner ? { owner } : {}),
      shared: item.shared === true || item.is_mine === false,
      transcript: item.has_transcript === true,
      ...(summary ? { summary } : {}),
    })
  }
  const next = text(page.next_cursor)
  const more = page.has_more === true
  if (more && next === undefined) pageError("search_meetings said has_more without a next_cursor")
  return { meetings, ...(more && next !== undefined ? { next } : {}), more, truncated: page.truncated === true }
}

/**
 * A position in the source's total order: the meeting's start time, then its id. A cursor resumes strictly after the
 * pair, so a page boundary between two meetings that share a start never skips the second, and never repeats the first.
 */
interface Key {
  readonly t: number
  readonly i: string
}

const compare = (a: Key, b: Key) => a.t - b.t || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0)
const digest = (owner: EventsOwner) => createHash("sha256").update(owner.id).digest("hex").slice(0, 16)
const binding = (account: string): CursorBinding => ({ plugin: "wisprflow", source: SOURCE, account })
const isoFloor = (time: number) => new Date(Math.floor(time / 1000) * 1000).toISOString()
const isoCeil = (time: number) => new Date(Math.ceil(time / 1000) * 1000).toISOString()

/** A meeting's tag in a cursor: the first TAG_LENGTH base64url characters of the sha256 of its id. */
const tagOf = (id: string) => createHash("sha256").update(id).digest("base64url").slice(0, TAG_LENGTH)

/** What a cursor holds: the position, the owner's digest, the look-back it covers, from `floor`, with the tags of the meetings it accounted for there. */
interface CursorState {
  readonly key: Key
  readonly owner: string
  readonly floor: number
  readonly tags: ReadonlySet<string>
  /** The line this read restarted at after its gap, while the position is still within a day of it. */
  readonly line?: number
}

/** The state a cursor holds: anything that is not this source's bound cursor is CURSOR_INVALID. */
function cursorState(account: string, cursor: string): CursorState {
  const decoded = decodeBoundCursor(binding(account), cursor)
  const state = decoded.ok ? decoded.state : undefined
  const [t, i, o, f, r, g] = [state?.t, state?.i, state?.o, state?.f, state?.r, state?.g]
  const invalid = () => refuse("CURSOR_INVALID", "The cursor was not issued for this source and account", CURSOR_NEXT)
  if (typeof t !== "number" || !Number.isSafeInteger(t) || typeof i !== "string" || typeof o !== "string" || !/^[0-9a-f]{16}$/.test(o)) return invalid()
  if (g !== undefined && (typeof g !== "number" || !Number.isSafeInteger(g) || g > t + 1)) return invalid()
  const line = typeof g === "number" ? { line: g } : {}
  if (typeof f !== "number" || !Number.isSafeInteger(f) || f > t + 1 || typeof r !== "string" || r.length % TAG_LENGTH !== 0 || r.length > MAX_TAGS * TAG_LENGTH || !/^[A-Za-z0-9_-]*$/.test(r)) return invalid()
  const tags = new Set(Array.from({ length: r.length / TAG_LENGTH }, (_, index) => r.slice(index * TAG_LENGTH, (index + 1) * TAG_LENGTH)))
  return { key: { t, i }, owner: o, floor: f, tags, ...line }
}

/** A stretch [from, to] the provider caps even at a minute: its meetings cannot all be read, so a read gaps over it. */
interface Hole {
  readonly from: number
  readonly to: number
}

/**
 * Every meeting that started within [from, to]: `since` and `until` are whole seconds around it, every page of it. A
 * window the provider caps (truncated, or more pages than MAX_PAGES) is split in two and each half read again, so a cap
 * loses nothing; a minute it still caps is a hole, with none of its meetings.
 */
async function searchWindow(search: Search, from: number, to: number): Promise<{ readonly meetings: MeetingFacts[]; readonly holes: Hole[] }> {
  const filters = { since: isoFloor(from), until: isoCeil(to + 1), limit: PAGE_SIZE }
  const found: MeetingFacts[] = []
  let cursor: string | undefined
  const split = async () => {
    if (to - from < MIN_SPLIT_MS) return { meetings: [], holes: [{ from, to }] }
    const middle = from + Math.floor((to - from) / 2)
    const [early, late] = [await searchWindow(search, from, middle), await searchWindow(search, middle + 1, to)]
    return { meetings: [...early.meetings, ...late.meetings], holes: [...early.holes, ...late.holes] }
  }
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) return split()
    const result = readMeetingsPage(await search({ ...filters, ...(cursor === undefined ? {} : { cursor }) }))
    if (result.truncated) return split()
    if (result.more && result.next === cursor) pageError("search_meetings repeated the cursor while has_more")
    found.push(...result.meetings.filter((meeting) => meeting.time >= from && meeting.time <= to))
    if (!result.more || result.next === undefined) return { meetings: found, holes: [] }
    cursor = result.next
  }
}

const actorID = (attendee: Attendee) => {
  if (attendee.email) return `mailto:${attendee.email}`
  return `name:${encodeURIComponent((attendee.name ?? "").replace(/\s+/g, " "))}`
}

function toEvent(meeting: MeetingFacts, account: string): SourceEvent {
  return makeEvent({
    source: SOURCE,
    account,
    external_id: meeting.id,
    kind: "meeting",
    occurred_at: meeting.time,
    thread: null,
    actors: [
      ...(meeting.owner ? [{ role: "owner", id: actorID(meeting.owner), ...(meeting.owner.name ? { name: meeting.owner.name } : {}) }] : []),
      ...meeting.attendees.map((attendee) => ({ role: "attendee", id: actorID(attendee), ...(attendee.name ? { name: attendee.name } : {}) })),
    ],
    title: meeting.title,
    text: meeting.summary ?? "",
    url: meeting.url ?? null,
    labels: [...(meeting.shared ? ["shared"] : []), ...(meeting.transcript ? ["transcript"] : [])],
  })
}

/**
 * One page of events. `search` runs `search_meetings` as the caller; `owner` is the sign-in; `account` is the resolved
 * alias; `now` fixes the clock. The input, the cursor and the sign-in's owner are checked before any read.
 */
export async function listEvents(search: Search, owner: EventsOwner, account: string, packageName: string, input: unknown, now: number): Promise<EventsListResult> {
  const parsed = parseEventsListInput(input)
  if (!parsed.ok) refuse("INPUT_INVALID", `The events_list input is invalid: ${parsed.problems.join("; ")}`, "Pass only since, cursor, limit (1 to 500), account and source, as the tool's schema describes.")
  const request = parsed.value
  if (request.source !== undefined && request.source !== SOURCE) refuse("SOURCE_UNKNOWN", "This plugin lists one source, wisprflow", 'Leave source out, or pass "wisprflow".')
  const cursor = request.cursor === undefined ? undefined : cursorState(account, request.cursor)
  const ownerDigest = digest(owner)
  if (cursor !== undefined && cursor.owner !== ownerDigest) {
    refuse("ACCOUNT_MISMATCH", "The cursor was issued for another Wispr Flow sign-in than the one OpenCode holds now", "Call probe to see who is signed in, then start again with since.")
  }
  const start: Key = cursor?.key ?? { t: startTime(request, now), i: "" }
  const end = now - SETTLE_MS
  // A read that starts before what the free plan shows answers the gap once, here, and restarts at the gap line, 29
  // days ago, which its cursor carries. A cursor that carries a line gaps again only behind the real 30 days, so the
  // read's later pages, read moments or hours later, carry no gap.
  const horizon = now - VISIBLE_MS
  const restartLine = now - (VISIBLE_MS - MARGIN_MS)
  const gapLine = cursor?.line !== undefined ? horizon : restartLine
  const gap = start.t < gapLine ? { reason: "expired" as const, since: new Date(start.t).toISOString() } : undefined
  const after: Key = gap ? { t: restartLine, i: "" } : start
  const line = gap ? restartLine : cursor?.line
  // The look-back: from `floor` up to the position, a meeting without a tag reached the provider after the cursor passed it.
  const floor = gap || !cursor ? after.t : Math.max(cursor.floor, horizon)
  const tags = gap || !cursor ? new Set<string>() : cursor.tags

  const seen = new Map<string, MeetingFacts>()
  const found = new Map<string, MeetingFacts>()
  const holes: Hole[] = []
  let scanned = Math.min(floor, after.t)
  for (let from = scanned, windows = 0; from <= end && windows < MAX_WINDOWS && found.size <= request.limit; windows++) {
    const to = Math.min(from + WINDOW_MS, end)
    const searched = await searchWindow(search, from, to)
    holes.push(...searched.holes)
    for (const meeting of searched.meetings) {
      seen.set(meeting.id, meeting)
      const key = { t: meeting.time, i: meeting.id }
      const late = compare(key, after) <= 0 && meeting.time >= floor && !tags.has(tagOf(meeting.id))
      if (compare(key, after) > 0 || late) found.set(meeting.id, meeting)
    }
    scanned = to
    if (to >= end) break
    from = to
  }

  const ordered = [...found.values()].sort((a, b) => compare({ t: a.time, i: a.id }, { t: b.time, i: b.id }))
  // A hole ahead of the position: a page with meetings before it stops short of it; the page that reaches it first
  // answers a window-truncated gap (unless it already answers the expired one, which covers it) and stops short of the
  // next hole, so each hole is answered once and the cursor moves past it.
  const ahead = holes.filter((hole) => hole.to >= after.t).sort((a, b) => a.from - b.from)
  const before = (hole: Hole | undefined) => (hole ? ordered.filter((meeting) => meeting.time < hole.from) : ordered)
  let holeGap: { readonly reason: "window-truncated"; readonly since: string } | undefined
  let stop: Hole | undefined = ahead[0]
  if (stop && before(stop).length === 0) {
    holeGap = { reason: "window-truncated", since: new Date(Math.max(stop.from, after.t)).toISOString() }
    stop = ahead[1]
  }
  const candidates = before(stop)
  const chosen = candidates.slice(0, request.limit)
  // A meeting whose title or summary holds a secret is refused for good; the rest fill the page up to its size.
  const screened = screenEvents(chosen.map((meeting) => toEvent(meeting, account)))
  const fits = fitPage(screened.events, request.limit, MAX_BYTES)
  const page = screened.events.slice(0, fits)
  const index = new Map(chosen.map((meeting, position) => [meeting.id, position]))
  // The last meeting this page accounts for: every chosen one when the whole screened list fits, so a refused meeting
  // at the end is passed too; otherwise the last listed.
  const lastListed = page[fits - 1]
  const last = fits === screened.events.length ? chosen.length - 1 : lastListed === undefined ? -1 : (index.get(lastListed.external_id) ?? -1)
  const refused = screened.refused.filter((entry) => (index.get(entry.external_id) ?? Number.POSITIVE_INFINITY) <= last)
  const lastMeeting = chosen[last]
  const more = ordered.length > last + 1 || scanned < end || stop !== undefined
  // The position only moves forward: a page of late meetings alone leaves it where it was. A page that stops short of a
  // hole, having listed everything before it, moves up to the hole's start.
  const reached: Key =
    stop && last + 1 === candidates.length
      ? { t: stop.from, i: "" }
      : lastMeeting
        ? { t: lastMeeting.time, i: lastMeeting.id }
        : scanned > after.t
          ? { t: scanned, i: "" }
          : after
  const position: Key = compare(reached, after) > 0 ? reached : after
  // The line stays in the cursor until the position is a day clear of where a fresh read would gap (28 days), so the
  // line that moves with the clock never catches a page of this read up again.
  const carried = line !== undefined && position.t < restartLine + MARGIN_MS ? { g: Math.min(line, position.t) } : {}
  // The look-back's tags fit the cursor's 1,024 characters: at the extremes (very long ids, many ties) fewer are kept.
  const waiting = ordered.slice(last + 1)
  let next: string | undefined
  for (const [budget, keepWaiting] of [[MAX_RECENT, true], [MAX_RECENT, false], [24, false], [0, false]] as const) {
    try {
      next = encodeBoundCursor(binding(account), { o: ownerDigest, t: position.t, i: position.i, ...lookBack(seen, waiting, position, floor, budget, keepWaiting), ...carried })
      break
    } catch (error) {
      if (budget === 0) throw error
    }
  }
  const answered = gap ?? holeGap
  if (next === undefined) {
    throw new SourceError({ code: "UNAVAILABLE", what: "the page cursor could not be written", next: "Read again without the cursor." })
  }
  return eventsListResult({ source: SOURCE, account, owner }, page, next, more, {
    refused,
    plugin: packageName,
    asOf: new Date(now).toISOString(),
    ...(answered ? { gap: answered } : {}),
  })
}

/**
 * The look-back the next cursor covers: from LOOKBACK_MS behind its position (never before the read's own floor, and
 * never past a late meeting still waiting to be listed), the tags of every meeting seen there and accounted for; at most
 * `budget`, the newest, the floor moving past the oldest one dropped, but with `keepWaiting` never past a meeting still
 * waiting, so a few more tags are kept when meetings share a start.
 */
function lookBack(
  seen: ReadonlyMap<string, MeetingFacts>,
  waiting: readonly MeetingFacts[],
  position: Key,
  floor: number,
  budget: number,
  keepWaiting: boolean,
): { f: number; r: string } {
  const pending = new Set(waiting.map((meeting) => meeting.id))
  const behind = waiting.filter((meeting) => compare({ t: meeting.time, i: meeting.id }, position) <= 0).map((meeting) => meeting.time)
  const waitingFrom = behind.length > 0 ? Math.min(...behind) : Number.POSITIVE_INFINITY
  let from = Math.min(Math.max(floor, position.t - LOOKBACK_MS), waitingFrom)
  const covered = [...seen.values()]
    .filter((meeting) => meeting.time >= from && compare({ t: meeting.time, i: meeting.id }, position) <= 0 && !pending.has(meeting.id))
    .sort((a, b) => compare({ t: a.time, i: a.id }, { t: b.time, i: b.id }))
  if (covered.length > budget) {
    const boundary = budget === 0 ? covered.at(-1) : covered[covered.length - budget - 1]
    if (boundary !== undefined) from = boundary.time + 1
    // Never past a late meeting still waiting, such as one that shares a start with one just listed: its tag-mates stay.
    if (keepWaiting) from = Math.min(from, waitingFrom)
  }
  const kept = covered.filter((meeting) => meeting.time >= from)
  return { f: Math.min(from, position.t + 1), r: kept.map((meeting) => tagOf(meeting.id)).join("") }
}

/** The list registry holds 50 items. A list read returns no more. */
const LIST_CAP = 50
/** C0 and C1 control characters: JSON escapes each to six bytes, so a title holding many would blow `maxBytes`. */
const CONTROL = /\p{Cc}/gu

/** Meetings as the contract's `list` output: id and title. Not editable. A title that holds a secret is left out. */
export interface MeetingsList {
  readonly source: string
  readonly account: string
  readonly data: { readonly items: readonly { readonly id: string; readonly text: string }[]; readonly editable: false }
  readonly asOf: string
  readonly trust: "untrusted"
}

/** The source and input a snapshot read must carry; anything else is a caller error. */
function snapshotInput(input: Record<string, unknown>) {
  if (input.source !== undefined && input.source !== SOURCE) refuse("SOURCE_UNKNOWN", "This plugin lists one source, wisprflow", 'Leave source out, or pass "wisprflow".')
  if (input.list !== undefined && input.list !== "meetings") refuse("INPUT_INVALID", "The list snapshot takes list: meetings, and nothing else", 'Pass list "meetings" with source "wisprflow".')
  for (const key of ["cursor", "since", "limit", "scope"]) {
    if (input[key] !== undefined) refuse("INPUT_INVALID", `The meetings list does not take ${key}`, "Pass source and list only; read the events source for a cursor or a scope.")
  }
}

/**
 * The meetings list snapshot. It reads through the same `search_meetings` as `events_list`, over the window the free
 * plan still shows, and returns titles only.
 */
export async function meetingsList(search: Search, account: string, input: Record<string, unknown>, now: number): Promise<MeetingsList> {
  snapshotInput(input)
  const { meetings } = await searchWindow(search, now - (VISIBLE_MS - MARGIN_MS), now)
  const items: { id: string; text: string }[] = []
  const seen = new Set<string>()
  // Newest first before the item cap: a split window returns its early half before its late one.
  for (const meeting of [...meetings].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))) {
    if (items.length >= LIST_CAP) break
    const id = meeting.id.slice(0, 128)
    // The whole title is screened before the cut, so a secret that straddles 200 characters is still refused.
    const whole = meeting.title.replace(/\s+/g, " ").replace(CONTROL, "").trim()
    if (id === "" || whole === "" || seen.has(id) || secretKinds(whole).length > 0) continue
    seen.add(id)
    items.push({ id, text: whole.slice(0, 200) })
  }
  const answer: MeetingsList = {
    source: SOURCE,
    account,
    data: { items, editable: false },
    asOf: new Date(now).toISOString(),
    trust: "untrusted",
  }
  // `maxBytes` holds with 50 maximal items: drop items from the end, the oldest, until the answer fits.
  while (items.length > 0 && new TextEncoder().encode(JSON.stringify(answer)).length > MAX_BYTES) items.pop()
  return answer
}
