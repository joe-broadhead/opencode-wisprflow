// The docs and skills state the tool counts and list the tools RPC's methods. They must match src/wisprflow-tools.ts,
// so a change to the tool lists cannot leave a stale count or method behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PERSONAL_TOOLS, PLUGIN_READS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { TESTED_HOSTS } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"
import { LIVE } from "./wisprflow-catalog.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOCS = readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`)
// Everything a user or the model reads about the current release.
const FILES = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", ...DOCS, ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`)]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")

describe("docs", () => {
  test.each(FILES)("%s states the current number of read and write tools", (file) => {
    const reads = [...text(file).matchAll(/\b(\d+) (?:known )?read(?:s| tools)\b/g)].map((match) => Number(match[1]))
    const writes = [...text(file).matchAll(/\b(\d+) (?:known )?write(?:s| tools)\b/g)].map((match) => Number(match[1]))
    expect(reads.filter((count) => count !== READ_TOOLS.length)).toEqual([])
    expect(writes.filter((count) => count !== WRITE_TOOLS.length)).toEqual([])
  })

  test.each(FILES)("%s names only Wispr Flow tools the plugin knows", (file) => {
    const named = [...text(file).matchAll(/\bwisprflow_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...PLUGIN_READS, ...PERSONAL_TOOLS, ...WRITE_TOOLS].includes(tool))).toEqual([])
  })

  // S5: version numbers live in package.json and the CHANGELOG heading only, and nothing says the package is unreleased.
  test.each(["README.md", "CONTRIBUTING.md", ...DOCS])("%s names no version of the plugin and no pre-release state", (file) => {
    // D19: the README's install line names the release tag, and CONTRIBUTING's Releasing section names v0.0.0. Nothing else may.
    const body = file === "CONTRIBUTING.md" ? text(file).replace(/#{2,3} Releasing.*?(?= #{2,3} |$)/, "") : text(file).replace("opencode-wisprflow#v0.0.0", "")
    expect(body).not.toMatch(/opencode-wisprflow@\d|\bv?\d+\.\d+\.\d+-|\bv?0\.0\.\d\b|not (yet )?published|provisional|"private"/i)
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout wisprflow` finds no server: the README signs out first,
  // checks, then removes the plugin.
  test("the README's Uninstall signs out and checks before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout wisprflow")
    const check = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove @joe-broadhead/opencode-wisprflow")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(check).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(check)
  })

  // Every code the plugin's own code raises (the tools RPC's are in docs/scripting.md) has no service prefix and a row
  // in the configuration guide's Errors table.
  test("the configuration guide documents every error code the plugin raises, none with a service prefix", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    const codes = new Set(sources.flatMap((name) => [...readFileSync(join(ROOT, "src", name), "utf8").matchAll(/(?:wisprflowError|errorText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    expect([...codes].sort()).toEqual(["HOST_UNTESTED", "OPTIONS_INVALID", "RULES_NOT_ADDED", "SERVER_NOT_REGISTERED", "SKILLS_INVALID", "STATUS_UNAVAILABLE"])
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    for (const code of codes) {
      expect(code).not.toStartWith("WISPRFLOW_")
      expect(errors).toContain(`| \`${code}\` |`)
    }
  })

  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts") && name !== "tools-rpc.ts")
    const raised = sources.map((name) => readFileSync(join(ROOT, "src", name), "utf8")).join("\n")
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !raised.includes(`"${code}"`) && !raised.includes(`${code}:`))).toEqual([])
  })

  test("the README explains the Skills row that names a replacing skill, and its fix", () => {
    expect(text("README.md")).toMatch(/Skills.*is replaced by.*Rename or move/)
  })

  test("the Jelly guide states the declared tool counts, and says Jelly drops unknown keys rather than refusing them", () => {
    const tools = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.tools as { readOnly: boolean }[]
    expect(text("docs/jelly.md")).toContain(`${tools.length} tools are declared (${tools.filter((tool) => tool.readOnly).length} read-only)`)
    expect(text("docs/jelly.md")).not.toMatch(/`latest` is|None yet|refuses/)
    expect(text("docs/jelly.md")).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
  })

  // An admin copies these blocks into managed config: each must be the plugin's real block for that access value.
  test("the configuration guide prints the default rules in full for every access value, and in the agent fix example", () => {
    const raw = readFileSync(join(ROOT, "docs/configuration.md"), "utf8")
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const block = new RegExp(`\`access: "${access}"\`[\\s\\S]*?\n\n\`\`\`json\n([\\s\\S]*?)\n\`\`\``).exec(raw)?.[1] ?? "[]"
      expect({ access, block: JSON.parse(block) }).toEqual({ access, block: defaultRules(access) })
    }
    const example = /For an agent `reviewer`[\s\S]*?```json\n([\s\S]*?)\n```/.exec(raw)?.[1] ?? "{}"
    const permissions = (JSON.parse(example) as { agents: { reviewer: { permissions: unknown[] } } }).agents.reviewer.permissions
    expect(permissions.slice(0, defaultRules("all").length)).toEqual(defaultRules("all"))
  })

  // A user who relies on the privacy recipe must not have a tool that returns a transcript or a note's text left allowed.
  test("the privacy recipe asks for exactly the tools whose results can hold a meeting's or a note's body, and names the pre-read tools", () => {
    const raw = readFileSync(join(ROOT, "docs/configuration.md"), "utf8")
    const block = /Ask before opening any meeting or note\.[\s\S]*?```json\n([\s\S]*?)\n```([\s\S]*?)\n### /.exec(raw)
    const rules = JSON.parse(block?.[1] ?? "[]") as { action: string; resource: string; effect: string }[]
    const body = Object.entries(LIVE).filter(([, tool]) => tool.body).map(([name]) => `wisprflow_${name}`)
    expect(body.length).toBeGreaterThan(3)
    expect(rules.map((rule) => rule.action).sort()).toEqual(body.sort())
    for (const rule of rules) expect([rule.resource, rule.effect]).toEqual(["*", "ask"])
    for (const [name, tool] of Object.entries(LIVE)) if (tool.preread) expect(block?.[2]).toContain(`wisprflow_${name}`)
  })

  test("the scripting guide lists every known tool as a method", () => {
    const guide = text("docs/scripting.md")
    for (const name of [...READ_TOOLS, ...PERSONAL_TOOLS]) expect(guide).toContain(`\`${name}\``)
    expect(guide).toContain("`describe`")
    expect(guide).toContain("x-opencode-directory")
  })
})

// The README prints the block the plugin inserts, in full, generated from defaultRules(): it is what an administrator
// copies into an agent's own permissions, so it cannot be elided or drift.
describe("the default rules block", () => {
  test("the README's Permissions section prints defaultRules() in full", () => {
    const section = /## Permissions([\s\S]*?)## Configure/.exec(readFileSync(join(ROOT, "README.md"), "utf8"))?.[1] ?? ""
    const printed = /generated from[\s\S]*?```json\n([\s\S]*?)\n```/.exec(section)?.[1] ?? "[]"
    expect(JSON.parse(printed)).toEqual(defaultRules())
  })
})

// Every "tested on …" mention states TESTED_HOSTS, so a release added to the list cannot leave a stale sentence behind.
describe("tested hosts", () => {
  const UNRELEASED = /## \[Unreleased\]([\s\S]*?)(?=\n## |$)/.exec(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))?.[1] ?? ""
  const SOURCES: [string, string][] = [
    ["README.md", readFileSync(join(ROOT, "README.md"), "utf8")],
    ["AGENTS.md", readFileSync(join(ROOT, "AGENTS.md"), "utf8")],
    ["SECURITY.md", readFileSync(join(ROOT, "SECURITY.md"), "utf8")],
    ["docs/configuration.md", readFileSync(join(ROOT, "docs/configuration.md"), "utf8")],
    ["CHANGELOG.md (Unreleased)", UNRELEASED],
  ]

  test.each(SOURCES)("%s names exactly TESTED_HOSTS wherever it says what is tested", (file, text) => {
    // The sentence that says something is tested, so a version list in the next sentence cannot leak in.
    const mentions = text
      .split("\n")
      .flatMap((line) => line.split(/\.\s+/))
      .filter((sentence) => /\btested\b/i.test(sentence))
      // The supported range is not a tested release: drop a backticked `>=a.b.c <d.e.f` span before reading versions.
      .map((sentence) => sentence.replace(/`[^`]*>=[^`]*`/g, ""))
      .map((sentence) => [...sentence.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((version) => version[0]!))
      .filter((versions) => versions.length > 0)
    expect({ file, versions: mentions.every((versions) => versions.length > 0) }).toEqual({ file, versions: true })
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  test("the README's Requirements line names every tested release", () => {
    const requirements = /## Requirements([\s\S]*?)## /i.exec(readFileSync(join(ROOT, "README.md"), "utf8"))?.[1] ?? ""
    const named = [...requirements.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).filter((version) => version !== "2.3.0")
    expect([...new Set(named)].sort()).toEqual([...TESTED_HOSTS].sort())
  })

  // A release inside the range that ships later is the untested example, so it must be one that never ships.
  test("the untested example is 2.2.99, and no doc names a future release as tested", () => {
    const all = SOURCES.map(([, text]) => text).join("\n")
    expect(all).toContain("2.2.99")
    expect(all).not.toMatch(/\b2\.2\.(?:7|8|9[0-8])\b(?!\d)/)
  })
})
