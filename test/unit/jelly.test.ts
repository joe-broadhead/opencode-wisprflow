import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { ACCESS_VALUES, parseOptions } from "../../src/options.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"
import { PERSONAL_TOOLS, PLUGIN_READS, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type DeclaredSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

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

  test("declares every Wispr Flow tool as allowed, reads first, in list order", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    // Every tool is allowed by default, so Jelly's declaration allows the reads too, `get_participant_contacts` included.
    for (const tool of PERSONAL_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of WRITE_TOOLS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "ask", readOnly: false })
    // The plugin's own read, events_list, is declared after Wispr Flow's reads.
    for (const tool of PLUGIN_READS) expect(byPermission.get(`wisprflow_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    expect(jelly.tools.map((tool) => tool.permission)).toEqual([...READ_TOOLS, ...PLUGIN_READS, ...PERSONAL_TOOLS, ...WRITE_TOOLS].map((tool) => `wisprflow_${tool}`))
  })



  test("has no views, RPC or Home contributions, and one sign-in: the wisprflow server", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [{ key: "access", label: "Access", type: "string", choices: ACCESS_CHOICES, default: parseOptions({}).access, description: expect.any(String) }] })
    expect(parseOptions({ access: "read-only" }).access).toBe("read-only")
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
  })

  test("its settings pass Jelly's setting contract, and access offers only values the parser takes", () => {
    const { settings } = jelly.contributes as { settings: DeclaredSetting[] }
    expect(settingsProblems(settings)).toEqual([])
    const access = settings.find((setting) => setting.key === "access")!
    const values = settingChoices(access)!.map((choice) => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) {
      expect(settingValueIssue(access, value)).toBeNull()
      expect(parseOptions({ access: value }).access as string).toBe(value)
    }
    for (const outside of ["write", "read", "none", ""]) {
      expect(settingValueIssue(access, outside)).not.toBeNull()
      expect(() => parseOptions({ access: outside })).toThrow("OPTIONS_INVALID")
    }
  })

})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
