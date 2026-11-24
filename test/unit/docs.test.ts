// The docs and skills state the tool counts and list the tools RPC's methods. They must match src/wisprflow-tools.ts,
// so a change to the tool lists cannot leave a stale count or method behind, and every repository link must point at
// this repository's new name and the master branch.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PERSONAL_TOOLS, PLUGIN_METHODS, PLUGIN_READS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { NAMESPACE_DESCRIPTION, TESTED_HOSTS } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"
import { LIVE } from "./wisprflow-catalog.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOCS = readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`)
// Everything a user or the model reads about the current release.
const FILES = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "AGENTS.md", "CHANGELOG.md", ...DOCS, ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`)]
const SPEC = "we-the-rebel-alliance/wisprflow-plugin#v<version>"
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")

describe("docs", () => {
  test.each(FILES)("%s states the current number of read and write tools", (file) => {
    const reads = [...text(file).matchAll(/\b(\d+) (?:known )?read(?:s| tools)\b/g)].map((match) => Number(match[1]))
    const writes = [...text(file).matchAll(/\b(\d+) (?:known )?write(?:s| tools)\b/g)].map((match) => Number(match[1]))
    expect(reads.filter((count) => count !== READ_TOOLS.length)).toEqual([])
    expect(writes.filter((count) => count !== WRITE_TOOLS.length)).toEqual([])
  })

  test.each(FILES)("%s names only Wispr Flow tools and plugin reads the plugin knows", (file) => {
    const named = [...text(file).matchAll(/\bwisprflow_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...PLUGIN_READS, ...PLUGIN_METHODS, ...PERSONAL_TOOLS, ...WRITE_TOOLS].includes(tool))).toEqual([])
  })

  // Version numbers live in package.json and the CHANGELOG heading only; every install line names this release.
  test.each(FILES)("%s names no plugin version but 0.0.0, and no pre-release state", (file) => {
    const body = file === "CHANGELOG.md" ? "" : text(file)
    const versions = [...body.matchAll(/wisprflow-plugin#v(\d+\.\d+\.\d+)/g)].map((match) => match[1])
    expect(versions.filter((entry) => entry !== "0.0.0")).toEqual([])
    expect(body).not.toMatch(/opencode-wisprflow|\bnot (?:yet )?published\b|provisional/i)
  })

  test.each(FILES)("%s links only to this repository, on master", (file) => {
    const body = readFileSync(join(ROOT, file), "utf8")
    expect(body).not.toMatch(/joe-broadhead|opencode-wisprflow|\/blob\/HEAD\//)
    for (const link of body.match(/https:\/\/github\.com\/[^\s)>]+/g) ?? []) {
      // Third-party links, such as OpenCode's own source, are not repository links of this plugin.
      if (!link.includes("we-the-rebel-alliance/wisprflow-plugin")) continue
      expect(link).toMatch(/^https:\/\/github\.com\/we-the-rebel-alliance\/wisprflow-plugin(?:\/blob\/master\/|\/issues\/|\/security\/|$)/)
    }
    for (const link of body.match(/https:\/\/raw\.githubusercontent\.com\/[^\s)>]+/g) ?? []) {
      expect(link).toStartWith("https://raw.githubusercontent.com/we-the-rebel-alliance/wisprflow-plugin/master/")
    }
  })

  test("the install line names this repository, a release tag and the first release", () => {
    const readme = text("README.md")
    expect(readme).toContain(`opencode plugin add github:${SPEC}`)
    expect(readme).toContain("Install from a release: `opencode plugin add github:we-the-rebel-alliance/wisprflow-plugin#v<version>`. The first release on plugin-contract is v0.0.0 (phase 4b).")
  })

  test.each(FILES)("%s installs only from a release tag", (file) => {
    for (const match of text(file).matchAll(/opencode plugin add (github:we-the-rebel-alliance\/wisprflow-plugin[^\s`"]*)/g)) {
      expect({ file, spec: match[1] }).toEqual({ file, spec: expect.stringContaining("#v") })
    }
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout wisprflow` finds no server: the README signs out first,
  // checks, then removes the plugin.
  test("the README's Uninstall signs out and checks before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout wisprflow")
    const check = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf(`opencode plugin remove github:${SPEC}`)
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

// The fixed-context budget: the namespace line and every skill description are sent on every turn.
describe("fixed context", () => {
  test("the namespace line is at most 400 characters", () => {
    expect(NAMESPACE_DESCRIPTION.length).toBeLessThanOrEqual(400)
  })

  test("every skill description is at most 300 characters", () => {
    for (const name of readdirSync(join(ROOT, "skills"))) {
      const body = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8")
      const description = /^description: (.*)$/m.exec(body)?.[1] ?? ""
      expect({ name, length: description.length, within: description.length <= 300 }).toEqual({ name, length: description.length, within: true })
    }
  })

  test("no tool is pinned and no per-request hook is added", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    for (const name of sources) {
      const body = readFileSync(join(ROOT, "src", name), "utf8")
      expect({ name, pinned: /\bpinned\s*:/.test(body) }).toEqual({ name, pinned: false })
      expect({ name, hook: /\b(?:session|permission)\.hook\s*\(/.test(body) }).toEqual({ name, hook: false })
    }
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
  // The upcoming release: the one section, up to the next "## " heading.
  const RELEASE = /## 0\.0\.0 \(unreleased\)([\s\S]*?)(?=\n## |$)/.exec(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"))?.[1] ?? ""
  const SOURCES: [string, string][] = [
    ["README.md", readFileSync(join(ROOT, "README.md"), "utf8")],
    ["AGENTS.md", readFileSync(join(ROOT, "AGENTS.md"), "utf8")],
    ["SECURITY.md", readFileSync(join(ROOT, "SECURITY.md"), "utf8")],
    ["docs/configuration.md", readFileSync(join(ROOT, "docs/configuration.md"), "utf8")],
    ["CHANGELOG.md (the release section)", RELEASE],
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
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  test("the README's Requirements line names every tested release", () => {
    const requirements = /## Requirements([\s\S]*?)## /i.exec(readFileSync(join(ROOT, "README.md"), "utf8"))?.[1] ?? ""
    const named = [...requirements.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).filter((version) => version !== "2.5.0")
    expect([...new Set(named)].sort()).toEqual([...TESTED_HOSTS].sort())
  })

  // A release inside the range that ships later is the untested example, so it must be one that never ships.
  test("the untested example is 2.4.99, and no doc names a future release as tested", () => {
    const all = SOURCES.map(([, text]) => text).join("\n")
    expect(all).toContain("2.4.99")
    expect(all).not.toMatch(/\b2\.4\.(?:[2-9]|[1-8]\d|9[0-8])\b(?!\d)/)
    expect(all).not.toMatch(/\b2\.5\.[1-9]\d*\b/)
  })
})
