// Every call example a user or the model copies, in the skills, the README and the scripting guide, uses only tools
// and parameters that Wispr Flow's live schemas have (test/unit/wisprflow-catalog.ts), and passes each tool's required
// parameters. Every backticked snake_case name in the skills is a tool, a parameter or a result field Wispr Flow
// describes, so a renamed field can't linger in the teaching.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { LIVE, RESULT_FIELDS, VIEW_KEYS } from "./wisprflow-catalog.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const SKILLS = readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`)
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

/** The keys of an object literal's text, at any depth: `key: value` and the shorthand `key`. */
const keysOf = (object: string) =>
  [...object.replace(/"[^"]*"(\s*:)?/g, (string, key: string | undefined) => (key ? string : '""')).matchAll(/(?<=[{,]\s*)"?([a-z_]+)"?(?=\s*[:,}])/g)].map((match) => match[1]!)

/** `tools.wisprflow.<tool>({ … })` in Code Mode examples. */
function codeExamples(text: string) {
  return [...text.matchAll(/tools\.wisprflow\.([a-z_]+)\((\{[^\n]*\})?\)/g)].map((match) => ({ tool: match[1]!, keys: keysOf(match[2] ?? "{}") }))
}

/** `opencode api post /api/rpc/wisprflow.meetings.tools/<tool> -d '{"input":{"sessionID":…,"input":{…}}}'`. */
function scriptExamples(text: string) {
  const flat = text.replace(/\s+/g, "")
  return [...flat.matchAll(/\/api\/rpc\/wisprflow\.meetings\.tools\/([a-z_]+)(?:\\?-H"[^"]*")?\\?-d'\{"input":\{"sessionID":"[^"]*","input":(\{.*?\})\}\}'/g)].map((match) => ({
    tool: match[1]!,
    keys: keysOf(match[2]!),
  }))
}

function check(examples: { tool: string; keys: string[] }[]) {
  for (const { tool, keys } of examples) {
    const live = LIVE[tool]
    expect({ tool, known: live !== undefined }).toEqual({ tool, known: true })
    const allowed = [...live!.params, ...(live!.params.some((param) => param.startsWith("view_")) ? VIEW_KEYS : [])]
    expect({ tool, unknown: keys.filter((key) => !allowed.includes(key)) }).toEqual({ tool, unknown: [] })
    expect({ tool, missing: live!.required.filter((param) => !keys.includes(param)) }).toEqual({ tool, missing: [] })
  }
}

describe("call examples", () => {
  test.each(SKILLS)("%s calls only live tools, with live parameter names and every required one", (file) => {
    const examples = codeExamples(read(file))
    check(examples)
    if (file === "skills/wisprflow/SKILL.md") expect(examples.length).toBeGreaterThan(4)
  })

  test.each(["README.md", "docs/scripting.md"])("%s's script examples call only live tools, with live parameter names", (file) => {
    const examples = scriptExamples(read(file))
    expect(examples.length).toBeGreaterThan(0)
    check(examples)
  })

  test.each(SKILLS)("%s names in backticks only tools, parameters and result fields Wispr Flow has", (file) => {
    const known = new Set([...Object.keys(LIVE), ...Object.values(LIVE).flatMap((tool) => tool.params), ...VIEW_KEYS, ...RESULT_FIELDS])
    // Names that aren't Wispr Flow's: Utilities' on-device speech tool.
    const others = new Set(["speech_transcribe"])
    const named = [...read(file).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!)
    expect(named.filter((name) => !known.has(name) && !others.has(name))).toEqual([])
  })

  test("the parser finds keys at any depth and in shorthand", () => {
    expect(keysOf('{ meeting_id, view_transcript: { start_char: next }, query: "a, b: c" }')).toEqual(["meeting_id", "view_transcript", "start_char", "query"])
  })
})
