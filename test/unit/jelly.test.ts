import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly writes each declared effect
 * as that tool's default (its agents have no base allow rule, so this plugin's own rules never reach them), so each
 * declared effect must be what the default rules give the tool in OpenCode.
 */

type Tool = { name: string; permission: string; effect: Rule["effect"]; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[]
  jelly: { summary: string; icon: string }
}
// The drawing elements Jelly's icon cleaner keeps (hey-jelly `plugin-icon.ts`). It drops a whole icon that has any
// other element, so a `<title>` is refused too.
const ICON_ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs"])
for (const name of ["linearGradient", "radialGradient", "stop", "clipPath", "mask"]) ICON_ELEMENTS.add(name)
const jelly = (pkg as { jelly: unknown }).jelly as {
  title: string
  tools: Tool[]
  skills: string[]
  rpc: unknown[]
  views: unknown[]
  signIns: unknown[]
  contributes: unknown
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

describe("the jelly declaration", () => {
  test("declares Wispr Flow's reads as reads that run and its writes as writes that ask, reads first, in list order", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    // A read that asks is declared as an ask, so Jelly, whose agents never get the plugin's rules, asks too.
    for (const tool of ASK_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "ask", readOnly: true })
    for (const tool of WRITE_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "ask", readOnly: false })
    expect(jelly.tools.map((tool) => tool.permission)).toEqual([...READ_TOOLS, ...ASK_TOOLS, ...WRITE_TOOLS].map((tool) => `wisprflow_${tool}`))
  })

  test("each declared effect is what the default rules give the tool after an agent's base allow", () => {
    const rules = [BASE_ALLOW, ...defaultRules()]
    for (const tool of jelly.tools) expect([tool.permission, evaluate(rules, tool.permission)]).toEqual([tool.permission, tool.effect])
  })

  test("each tool's name is its permission with a dot after the server name", () => {
    for (const tool of jelly.tools) {
      expect(tool.name).toStartWith(`${SERVER_NAME}.`)
      expect(tool.name.replace(".", "_")).toBe(tool.permission)
    }
  })

  test("pins the keys Jelly's declaration reads; Jelly's schema drops any other top-level key", () => {
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("has no views, RPC or Home contributions, and one sign-in: the wisprflow server", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
  })

  test("names every skill the package ships", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(pkg.jelly.summary.trim().length).toBeGreaterThan(0)
    expect(pkg.jelly.summary.length).toBeLessThanOrEqual(120)
    expect(pkg.jelly.summary).not.toContain("\n")
  })

  test("the icon is assets/icon.svg, shipped, with one svg root, xmlns and a 24 or 32 viewBox, only drawing elements, under 2 KB", () => {
    expect(pkg.jelly.icon).toBe("assets/icon.svg")
    expect(pkg.files).toContain(pkg.jelly.icon)
    const svg = readFileSync(new URL(`../../${pkg.jelly.icon}`, import.meta.url), "utf8").trim()
    expect(svg.length).toBeLessThan(2048)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (24 24|32 32)"/)
    expect(svg.endsWith("</svg>")).toBe(true)
    expect(svg).not.toMatch(/<title|<style|<script|&|<!/i)
    const elements = [...svg.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1])
    expect(elements.filter((name) => !ICON_ELEMENTS.has(name!))).toEqual([])
  })
})
