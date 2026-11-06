import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"
import { ASK_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly writes each declared effect
 * as that tool's default (its agents have no base allow rule, so this plugin's own rules never reach them), so each
 * declared effect must be what the default rules give the tool in OpenCode. The shared kit checks the declaration
 * against Jelly's plugin authors' standard; the tests below add what only Wispr Flow declares.
 */

const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { title: string; tools: DeclaredTool[]; rpc: unknown[]; views: unknown[]; contributes: unknown }
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate([BASE_ALLOW, ...defaultRules()], permission) })).toEqual([])
  })

  test("declares Wispr Flow's reads as reads that run and its writes as writes that ask, reads first, in list order", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    // A read that asks is declared as an ask, so Jelly, whose agents never get the plugin's rules, asks too.
    for (const tool of ASK_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "ask", readOnly: true })
    for (const tool of WRITE_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "ask", readOnly: false })
    expect(jelly.tools.map((tool) => tool.permission)).toEqual([...READ_TOOLS, ...ASK_TOOLS, ...WRITE_TOOLS].map((tool) => `wisprflow_${tool}`))
  })



  test("has no views, RPC or Home contributions, and one sign-in: the wisprflow server", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
  })


})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
