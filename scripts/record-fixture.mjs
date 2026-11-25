// Rewrites fixtures/conformance.json from the synthetic Wispr Flow in test/support/fake.ts.
//
//   npm run fixtures
//
// This script is specific to the plugin's deterministic test host: every answer is rebuilt from invented people,
// meetings and sign-ins, so the recording is reproducible. A provider with real accounts records with
// `npx plugin-kit record --account <alias>` instead.
import { mkdirSync, writeFileSync } from "node:fs"
import { manifest, packageName } from "../src/manifest.ts"
import { run, runtimeFor } from "../test/support/handlers.ts"
import { SINCE } from "../test/support/fake.ts"

const runtime = runtimeFor()
const source = manifest.sources.find((item) => item.kind === "events")
const snapshot = manifest.sources.find((item) => item.kind === "snapshot")
if (source === undefined || snapshot === undefined) throw new Error("the manifest declares no meetings sources")

const work = "work"
const personal = "personal"
const workPage = await run(runtime, "events_list", { source: "wisprflow", since: SINCE }, work)
const personalPage = await run(runtime, "events_list", { source: "wisprflow", since: SINCE }, personal)
const emptyPage = await run(runtime, "events_list", { source: "wisprflow", since: "2999-01-01" }, work)
const snapshotAnswer = await run(runtime, "events_list", { source: "wisprflow", list: "meetings" }, work)
const probe = await run(runtime, "probe", { source: "wisprflow" }, work)
const status = await run(runtime, "status", {})

async function refusal(input, account) {
  try {
    await run(runtime, "events_list", input, account)
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

const cursorOf = (page) => (page && typeof page === "object" && typeof page.cursor === "string" ? page.cursor : undefined)
const workCursor = cursorOf(workPage)
if (workCursor === undefined) throw new Error("the work page answered no cursor")
const crossed = await refusal({ source: "wisprflow", cursor: workCursor }, personal)
const unknownSource = await refusal({ source: "other" }, work)

const fixture = {
  plugin: packageName,
  accounts: {
    real: false,
    aliases: [work, personal],
    required: { method: "events_list", code: "ACCOUNT_REQUIRED" },
    unknown: { method: "events_list", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
    cursors: [{ method: "events_list", account: work, other: personal, code: "CURSOR_INVALID" }],
  },
  sources: {
    [source.id]: {
      cases: [
        { name: "the work account's meetings", input: { source: "wisprflow", account: work, since: SINCE }, expect: "page", answer: workPage },
        { name: "the personal account's own meeting", input: { source: "wisprflow", account: personal, since: SINCE }, expect: "page", answer: personalPage },
        { name: "an empty window", input: { source: "wisprflow", account: work, since: "2999-01-01" }, expect: "empty", answer: emptyPage },
        { name: "another account's cursor is refused", input: { source: "wisprflow", account: personal, cursor: workCursor }, expect: "CURSOR_INVALID", refuses: crossed },
        { name: "an unknown source is refused", input: { source: "other", account: work }, expect: "SOURCE_UNKNOWN", refuses: unknownSource },
      ],
      probe: { input: { source: "wisprflow", account: work }, answer: probe },
    },
    [snapshot.id]: {
      probe: { input: { source: "wisprflow", account: work }, answer: probe },
      snapshot: { input: { source: "wisprflow", list: "meetings", account: work }, answer: snapshotAnswer },
    },
  },
  events: { emitted: [], status },
  namespace: manifest.plugin.summary,
}

mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`recorded fixtures/conformance.json for ${packageName}`)
