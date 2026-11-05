---
name: wisprflow-meeting-brief
description: Load before the first Wispr Flow tool call for a brief, when the user names Wispr Flow, Flow or its Notetaker, gives a notes.wisprflow.ai link, or chooses Wispr Flow as the source - prep for their next or today's meeting from Wispr Flow's calendar, upcoming events and pre-reads, a catch-up on a recurring meeting before a call with a person or company, or a recap of a period's Wispr Flow meetings. Builds a sourced brief of decisions, open questions and who owes what. Not for Granola notes.
---

# Wispr Flow meeting brief

A short brief in which every claim is tied to a meeting. The `wisprflow` skill covers the tools, times, quoting and citing; follow it too.

## 1. Pin down the meeting and the window

- Wispr Flow sees the user's calendar, upcoming events included. For "my next meeting", call `tools.wisprflow.list_upcoming_meetings({ window_hours: 168 })` once, the whole week it allows, and take the soonest event that hasn't started. For "today's" or "tomorrow's" meeting, use `search_calendar_events` with that local day's bounds as `since` and `until`.
- When several events match, ask which one, or name the one you chose with its local start time. Never present a past meeting as the upcoming one.
- For history, start with the last 30 days. Widen once when that finds nothing, and say which window you used. For a recap of a period, that period is the window.

## 2. Use the pre-read if there is one

Each upcoming event carries its latest pre-read (`preread`), and `get_upcoming_meeting` with the event's `calendar_id` fetches it again. It is generated text: label what you take from it as Wispr Flow's pre-read. `preread: null` is normal: the desktop app makes pre-reads, and no tool does.

## 3. Find the history

- A recurring meeting: `list_meeting_series` with the `meeting_id` of a past occurrence the user owns, one without `shared: true` (find one with `search_meetings` on the title). `recurring: false` means it isn't a series.
- Otherwise `search_meetings` with the attendees' `attendee_emails` and the window, then by topic (`query`) without attendees: internal meetings often hold the answer.
- Read the last one or two with `get_meeting`. Ask for transcripts (`view_transcript: {}`) only where `has_transcript` is true and the brief needs a point from it, such as a decision's reason or a number.
- A meeting with `shared: true` is someone else's notes: attribute its commitments to the people in it, not to the user.
- When the searches by attendee and by topic find nothing in the widened window, stop and say so; an unrelated meeting isn't background. If every read came back empty and Wispr Flow gave no reason, report that it returned nothing for this account and window, and don't guess why, such as another account or sync. Suggest `/wisprflow-status`; it doesn't name the signed-in account, and what it shows is in the `wisprflow` skill's Sign-in.

## 4. Stay within the record

If the user named no notes app and another, such as Granola, is connected, say Wispr Flow is connected too, and ask which to use or check both, labelling each fact's source. Once the user named or chose Wispr Flow, build from it, and add another notes source only when asked. Build the brief from Wispr Flow's meetings and the event itself, and Scratchpad notes only when the user asks for them. Bring in other sources, such as mail, chat or trackers, only when the user asks, and name them as sources.

## 5. Write the brief

Use these sections, and leave out empty ones:

- **Purpose**: the meeting or question the brief serves, with its local date and time.
- **Background**: the relationship or topic so far, in date order.
- **Decisions**: what was agreed, with the meeting and local date.
- **Open questions and risks**
- **Commitments**: who owes what. Give an owner or due date only where a meeting states it; mark one that only the Flow Summary names as "per Wispr Flow's summary".
- **Suggested agenda**: for an upcoming meeting, marked as your suggestion.
- **Sources**: each meeting used, with its title, local date and `share_link`.

Report what was said in your own words, with no quotation marks around transcript or summary text unless the user asks for exact words. End with the scope: the window, the searches you ran, the meetings you read, and what is missing, such as meetings without a transcript. Never claim you searched every meeting.

## 6. After the brief

Offer the meetings' share links. Wispr Flow's tools change nothing, so any follow-up list stays in the chat.
