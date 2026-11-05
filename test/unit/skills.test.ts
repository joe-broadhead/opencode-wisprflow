// The shipped skills: exactly two, loadable by the plugin, short, free of internal jargon, and naming only Wispr Flow
// tools the plugin knows.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseSkill, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"
import { checkHost } from "../../src/host-version.js"
import { buildStatus, formatStatus } from "../../src/status.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"

const NAMES = [...SKILL_NAMES]
const MAX_LINES = 100
// Words from the plugin's own process that mean nothing to the model or the user.
const JARGON = /manifest|attest|quarantin|evidence|acceptance|harness|fixture|\bfork\b|dispatch|lease|catalog|allowlist|reviewed|capabilit|provisional|\bWS-[A-Z0-9]|PLAN\.md|drift|\bTODO\b/i
const KNOWN = [...READ_TOOLS, ...ASK_TOOLS, ...WRITE_TOOLS]
// A Wispr Flow tool name written bare, as the skills do after dropping the prefix.
const TOOL_SHAPED = /`((?:get|list|search|resolve|add|update|delete|create)_[a-z_]+)`/g

const read = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8")

describe("skills", () => {
  test("exactly the plugin's skills, each a single SKILL.md", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual([...NAMES].sort())
    for (const name of NAMES) expect(readdirSync(join(SKILLS_DIR, name))).toEqual(["SKILL.md"])
  })

  test.each(NAMES)("%s loads, is named after its folder and has a one-line description", (name) => {
    const text = read(name)
    const skill = parseSkill(name, join(SKILLS_DIR, name, "SKILL.md"), text)
    expect(skill.name as string).toBe(name)
    expect(skill.description?.length).toBeGreaterThan(40)
    expect(text.split("\n").filter((line) => line.startsWith("description:"))).toHaveLength(1)
    expect(skill.content.length).toBeGreaterThan(0)
  })

  test.each(NAMES)("%s is under the line limit and free of internal jargon", (name) => {
    const text = read(name)
    expect(text.split("\n").length).toBeLessThan(MAX_LINES)
    expect(text.match(JARGON)?.[0]).toBeUndefined()
  })

  test.each(NAMES)("%s names only Wispr Flow tools the plugin knows", (name) => {
    const text = read(name)
    const prefixed = [...text.matchAll(/\bwisprflow_([a-z_]+)\b|\btools\.wisprflow\.([a-z_]+)\b/g)].map((match) => (match[1] ?? match[2])!)
    const bare = [...text.matchAll(TOOL_SHAPED)].map((match) => match[1]!)
    expect([...prefixed, ...bare].filter((tool) => !KNOWN.includes(tool))).toEqual([])
  })

  test("both descriptions say to load before the first Wispr Flow call, and the main one stays off other notetakers and audio files", () => {
    for (const name of NAMES) expect(parseSkill(name, "/x", read(name)).description).toContain("Load before the first Wispr Flow tool call")
    const main = parseSkill("wisprflow", "/x", read("wisprflow")).description!
    expect(main).toContain("Not for Granola or Plaud")
    expect(main).toContain("dictation history")
  })

  // The namespace text tells the model to check Wispr Flow too when the user names no notes app and another is
  // connected, so neither description may argue against loading in that case; each still stays off Granola's own data.
  test("both descriptions load before any Wispr Flow call, name the app's own words, and leave Granola's data alone", () => {
    for (const name of NAMES) {
      const description = parseSkill(name, "/x", read(name)).description!
      expect(description).toContain("names Wispr Flow, Flow or its Notetaker")
      expect(description).toContain("notes.wisprflow.ai link")
      expect(description).toMatch(/Not for Granola/)
      expect(description).not.toMatch(/names no notes app|names none/)
    }
    expect(parseSkill("wisprflow-meeting-brief", "/x", read("wisprflow-meeting-brief")).description).toContain("or chooses Wispr Flow as the source")
    const rule = "named no notes app and another, such as Granola, is connected, say Wispr Flow is connected too, and ask which to use or check both, labelling each fact's source"
    for (const name of NAMES) expect(read(name)).toContain(rule)
    expect(read("wisprflow-meeting-brief")).toContain("Once the user named or chose Wispr Flow, build from it, and add another notes source only when asked.")
  })

  test("wisprflow loads for a Wispr Flow transcription request, to say it can't and route it on-device", () => {
    const description = parseSkill("wisprflow", "/x", read("wisprflow")).description!
    expect(description).toContain("or to transcribe an audio file, which this connection can't do")
    expect(read("wisprflow")).toContain("Utilities' on-device `speech_transcribe`")
  })

  test("both skills say what to do when Wispr Flow returns nothing, without blaming Cloud Sync", () => {
    for (const name of NAMES) {
      expect(read(name)).toMatch(/returned nothing for this account and window, and don't guess why, such as another account or sync[\s\S]*`\/wisprflow-status`/)
      // A stray hint about accounts reads as a cause; it lives only in Sign-in, as how to switch.
      expect(read(name)).not.toContain("Personal and work accounts hold separate content")
    }
    expect(read("wisprflow")).toContain("name Cloud Sync only when Wispr Flow's own error names it")
  })

  // The agents repeat what the skills say /wisprflow-status shows, so the claim must match the rows status really has.
  test("what /wisprflow-status shows is said once, in Sign-in, matches its rows, and never promises the account", () => {
    const claim = "which shows whether Wispr Flow is connected, how many tools it lists, and the next step. Don't promise it names the account: it shows one only when OpenCode holds a label for the sign-in"
    const signIn = read("wisprflow").split("## Sign-in")[1]?.split("\n## ")[0] ?? ""
    expect(signIn).toContain(claim)
    for (const name of NAMES) {
      const text = read(name)
      expect(text.split(claim).length - 1).toBe(name === "wisprflow" ? 1 : 0)
      const others = text.split("\n").filter((line) => line.includes("`/wisprflow-status`") && !line.includes(claim))
      for (const line of others) expect(line).toMatch(/what it shows is (?:under|in the `wisprflow` skill's) Sign-in/)
      expect(text).not.toMatch(/which account (?:is|it)/i)
    }
    const host = checkHost("2.2.3", false)
    const connected = formatStatus(buildStatus({ server: { status: "connected" }, host, tools: ["search_meetings"] }))
    for (const row of ["- Connection: connected", "- Tools: 1 available", "- Next step: "]) expect(connected).toContain(row)
    expect(connected).toContain("- Account: account name not reported by Wispr Flow's MCP")
    expect(formatStatus(buildStatus({ server: { status: "connected" }, host, tools: [], account: "Acme" }))).toContain("- Account: Acme")
  })

  test("both skills get the next meeting with one call over the whole week", () => {
    for (const name of NAMES) expect(read(name)).toMatch(/my next meeting", call [^\n]*`?(?:tools\.wisprflow\.)?list_upcoming_meetings\(\{ window_hours: 168 \}\)`? once|my next meeting", call it once with `window_hours: 168`/)
  })

  test("wisprflow states the dictation-history gap plainly, and never sends the user around it", () => {
    const text = read("wisprflow")
    expect(text).toContain("It can't read dictation history, the dictionary, snippets, styles, usage stats or Notetaker chat, and no tool takes audio.")
    expect(text).toContain("Never suggest an unofficial Wispr Flow server")
  })

  test("wisprflow sends the user to /wisprflow-status and the sign-in step when Wispr Flow is missing", () => {
    const text = read("wisprflow")
    expect(text).toContain("/wisprflow-status")
    expect(text).toContain("run `/connect` and choose Wispr Flow, then press `o` or Enter to open the link")
    expect(text).toContain("opencode mcp auth wisprflow")
  })

  test.each(NAMES)("%s links only to plain files an agent can read, never to a GitHub page", (name) => {
    const links = read(name).match(/https?:\/\/[^\s)>]*[^\s)>.,]/g) ?? []
    for (const link of links) expect(link).toMatch(/^https:\/\/raw\.githubusercontent\.com\/joe-broadhead\/opencode-wisprflow\/HEAD\//)
  })

  test("wisprflow's scripts section creates a session for the script and never borrows one", () => {
    const scripts = read("wisprflow").split("## Scripts")[1]?.split("\n## ")[0] ?? ""
    expect(scripts).toContain("wisprflow.meetings.tools")
    expect(scripts).toContain("opencode api post /api/session")
    expect(scripts).toMatch(/never borrow/i)
  })
})
