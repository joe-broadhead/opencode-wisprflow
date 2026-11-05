// Maintainer-run drift check against a saved copy of Wispr Flow's tool list. It warns; nothing at runtime depends on it.
//
//   npm run drift -- <tools.json> [--strict]
//
// <tools.json> is a saved tool list: a JSON object whose `tools` array holds each tool's `name`, `description` and
// `inputSchema`, and its `annotations` when the source has them, as `ctx.tool.list()` in OpenCode or an MCP client's
// `tools/list` gives them. CONTRIBUTING says how to save one. The script reads that file only: it never reads a
// credential and never calls Wispr Flow. It compares the list with READ_TOOLS, ASK_TOOLS and WRITE_TOOLS in
// src/wisprflow-tools.ts and with the parameters recorded in test/unit/wisprflow-catalog.ts, and prints only tool
// names, parameter names and Wispr Flow's readOnlyHint and destructiveHint annotations.
// Exit codes: 0 no drift, or drift without --strict; 1 drift with --strict; 2 usage or file error.
// Needs Node 22.18 or later, which loads both TypeScript files by stripping their types.
import { readFileSync } from "node:fs"

const USAGE = "Usage: node scripts/check-wisprflow-tools.mjs <tools.json> [--strict]"
// Wording that says a tool changes or sends something. A known read whose description gains it needs a second look.
const CHANGE_WORDS = /\b(creates?|updates?|deletes?|removes?|edits?|modif(?:y|ies)|writes?|sends?|posts?|uploads?|archives?)\b/i

let strict = false
let file
for (const arg of process.argv.slice(2)) {
  if (arg === "--strict") strict = true
  else if (!arg.startsWith("--") && file === undefined) file = arg
  else fail(`unknown argument "${arg}". ${USAGE}`)
}
if (file === undefined) fail(`no tool list given. ${USAGE}`)
if (!process.features.typescript) fail(`Node ${process.versions.node} cannot load TypeScript files. Use Node 22.18 or later.`)

const classified = await loadClassification()
const catalog = await loadCatalog()
const live = readToolList(file)

const known = new Set([...classified.read, ...classified.ask, ...classified.write])
const added = [...live.keys()].filter((name) => !known.has(name)).sort()
// A tool Wispr Flow lists only for some accounts is expected to be missing from one account's list.
const absent = [...known].filter((name) => !live.has(name))
const removed = absent.filter((name) => !catalog[name]?.conditional).sort()
const conditional = absent.filter((name) => catalog[name]?.conditional).sort()
const annotated = [...live.values()].some((tool) => tool.annotations !== undefined)
const reclassified = [...live]
  .filter(([name, { annotations: hints = {} }]) =>
    ((classified.read.has(name) || classified.ask.has(name)) && (hints.readOnlyHint === false || hints.destructiveHint === true))
    || (classified.write.has(name) && hints.readOnlyHint === true))
  .map(([name]) => name)
  .sort()
const changeWording = [...live]
  .filter(([name, tool]) => (classified.read.has(name) || classified.ask.has(name)) && CHANGE_WORDS.test(tool.description))
  .map(([name, tool]) => `${name}  (${tool.description.match(CHANGE_WORDS)[0]})`)
  .sort()
const parameters = [...live]
  .filter(([name]) => catalog[name])
  .flatMap(([name, tool]) => {
    const recorded = new Set(catalog[name].params)
    const now = new Set(tool.params)
    const plus = [...now].filter((param) => !recorded.has(param)).map((param) => `+${param}`)
    const minus = [...recorded].filter((param) => !now.has(param)).map((param) => `-${param}`)
    return plus.length + minus.length ? [`${name}: ${[...plus, ...minus].join(" ")}`] : []
  })
  .sort()

const count = (set) => [...live.keys()].filter((name) => set.has(name)).length
console.log(`The list holds ${live.size} tools: ${count(classified.read)} classified read, ${count(classified.ask)} classified ask, `
  + `${count(classified.write)} classified write, ${added.length} unclassified.`)
section("Added: listed by Wispr Flow, in no list of src/wisprflow-tools.ts", added, true)
section("Removed: in src/wisprflow-tools.ts, not in this list (an account may list fewer tools than the server has)", removed, false)
if (conditional.length) console.log(`\nNot listed, as expected for an account without the feature that adds them: ${conditional.join(", ")}.`)
section("Parameters changed: the input schema differs from test/unit/wisprflow-catalog.ts (the skills' examples use these names)", parameters, false)
section("Change wording: a known read's description now says it creates, changes or sends something; read it", changeWording, false)
if (annotated) section("Reclassified: the classification disagrees with Wispr Flow's annotations", reclassified, true)
else {
  console.log("\nNot checked: this list carries no annotations (OpenCode's tool list never does), so it can't show that Wispr Flow")
  console.log("marked a tool as changing data. Only a description's wording hints at that: read each new or changed description.")
}

const drift = added.length + removed.length + parameters.length + changeWording.length + (annotated ? reclassified.length : 0)
if (!drift) {
  console.log("\nNo drift.")
  process.exit(0)
}
console.log(`\nDrift: ${drift} item(s). Update src/wisprflow-tools.ts, test/unit/wisprflow-catalog.ts, package.json's jelly.tools and the skills after checking each tool's behaviour.`)
process.exit(strict ? 1 : 0)

function section(title, names, withHints) {
  if (!names.length) return
  console.log(`\n${title}:`)
  for (const name of names) console.log(`  ${printable(name)}${withHints && live.get(name)?.annotations ? `  ${hints(live.get(name).annotations)}` : ""}`)
}

function hints(annotations) {
  const show = (value) => (typeof value === "boolean" ? String(value) : "unset")
  return `readOnlyHint=${show(annotations.readOnlyHint)} destructiveHint=${show(annotations.destructiveHint)}`
}

// Names come from the server: print plain text as is and quote anything else.
function printable(text) {
  return /^[A-Za-z0-9_.\-:+ ()]{1,200}$/.test(text) ? text : JSON.stringify(text.slice(0, 200))
}

function readToolList(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`cannot read ${JSON.stringify(path)} as JSON (${clean(error?.code ?? error?.message ?? error)}).`)
  }
  if (!Array.isArray(parsed?.tools)) fail(`${JSON.stringify(path)} has no "tools" array. Save a tool list as CONTRIBUTING says. ${USAGE}`)
  const tools = new Map()
  for (const tool of parsed.tools) {
    if (typeof tool?.name !== "string") continue
    const properties = tool.inputSchema?.properties
    tools.set(tool.name, {
      description: typeof tool.description === "string" ? tool.description : "",
      params: properties && typeof properties === "object" ? Object.keys(properties) : [],
      ...(tool.annotations && typeof tool.annotations === "object" ? { annotations: tool.annotations } : {}),
    })
  }
  return tools
}

async function loadClassification() {
  const module = await load("../src/wisprflow-tools.ts")
  const list = (name) => {
    const value = module[name]
    if (!Array.isArray(value)) fail(`src/wisprflow-tools.ts must export ${name} as an array of tool names.`)
    return new Set(value)
  }
  return { read: list("READ_TOOLS"), ask: list("ASK_TOOLS"), write: list("WRITE_TOOLS") }
}

async function loadCatalog() {
  const { LIVE } = await load("../test/unit/wisprflow-catalog.ts")
  if (!LIVE || typeof LIVE !== "object") fail("test/unit/wisprflow-catalog.ts must export LIVE, each tool's recorded parameters.")
  return LIVE
}

async function load(path) {
  try {
    return await import(new URL(path, import.meta.url).href)
  } catch (error) {
    fail(`cannot load ${path.slice(3)} (${error?.code ?? error?.message ?? error}). Keep it free of runtime imports so Node can strip its types.`)
  }
}

function clean(text) {
  return String(text ?? "no message").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200)
}

function fail(message) {
  console.error(`check-wisprflow-tools: ${message}`)
  process.exit(2)
}
