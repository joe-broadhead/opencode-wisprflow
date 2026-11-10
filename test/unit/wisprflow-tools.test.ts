import { describe, expect, test } from "bun:test"
import { PERSONAL_TOOLS, classify, READ_TOOLS, WRITE_TOOLS } from "../../src/wisprflow-tools.js"
import { LIVE, LIVE_TOOLS } from "./wisprflow-catalog.js"

describe("classify", () => {
  test("knows Wispr Flow's 15 reads, the one read that asks, and no writes, each once", () => {
    expect(READ_TOOLS).toHaveLength(15)
    expect([...PERSONAL_TOOLS]).toEqual(["get_participant_contacts"])
    expect(WRITE_TOOLS).toHaveLength(0)
    const all = [...READ_TOOLS, ...PERSONAL_TOOLS, ...WRITE_TOOLS]
    expect(new Set(all).size).toBe(all.length)
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of PERSONAL_TOOLS) expect(classify(tool)).toBe("personal")
  })

  test("the known tools are exactly the catalog's; the recorded list holds all but those listed only for some accounts", () => {
    expect([...READ_TOOLS, ...PERSONAL_TOOLS, ...WRITE_TOOLS].sort()).toEqual(Object.keys(LIVE).sort())
    expect([...READ_TOOLS, ...WRITE_TOOLS].sort()).toEqual([...LIVE_TOOLS].sort())
    expect(PERSONAL_TOOLS.filter((tool) => !LIVE[tool]?.conditional)).toEqual([])
  })

  test("keeps the list sorted, so a change shows as one line", () => {
    expect([...READ_TOOLS]).toEqual([...READ_TOOLS].sort())
  })

  test("reads never change anything: no add, create, update, delete, send or share tool is a read", () => {
    expect(READ_TOOLS.filter((tool) => /^(add|create|update|delete|remove|save|set|send|share|upload|feedback|give)_/.test(tool))).toEqual([])
  })

  test("treats everything else as unknown, so it asks: the task tools and account tools some listings show included", () => {
    for (const tool of ["shiny_new_tool", "add_task", "update_task", "get_account_info", "wisprflow_search_meetings", "SEARCH_MEETINGS", ""]) {
      expect(classify(tool)).toBe("unknown")
    }
  })
})
