import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, parseSkill, registerSkills, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "wisprflow-skill-loading-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function skills(files: Record<string, string>) {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

describe("skill loading", () => {
  test("wisprflow and wisprflow-meeting-brief, from the package's skills folder", () => {
    expect([...SKILL_NAMES]).toEqual(["wisprflow", "wisprflow-meeting-brief"])
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills/")).toBe(true)
  })

  test("parses LF and CRLF frontmatter into a skill", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = ["---", "name: wisprflow", 'description: "Use Wispr Flow: find, read and cite meetings."', "---", "", "# Wispr Flow", "Body."].join(newline)
      expect(parseSkill("wisprflow", "/pkg/skills/wisprflow/SKILL.md", text)).toEqual({
        id: "wisprflow",
        name: "wisprflow",
        description: "Use Wispr Flow: find, read and cite meetings.",
        path: "/pkg/skills/wisprflow/SKILL.md",
        content: "# Wispr Flow\nBody.",
      } as never)
    }
  })

  test.each([
    ["no frontmatter", "# Wispr Flow", "skills/wisprflow/SKILL.md has no frontmatter"],
    ["the wrong name", "---\nname: other\ndescription: d\n---\n", 'skills/wisprflow/SKILL.md must be named "wisprflow" in its frontmatter'],
    ["no description", "---\nname: wisprflow\n---\n", "skills/wisprflow/SKILL.md has no description"],
  ])("rejects a skill with %s", (_, text, message) => {
    expect(() => parseSkill("wisprflow", "/x", text)).toThrow(message)
  })

  test("loads both skills", async () => {
    const ok = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`
    const directory = skills({ wisprflow: ok("wisprflow"), "wisprflow-meeting-brief": ok("wisprflow-meeting-brief") })
    const loaded = await loadSkills(directory)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual(["wisprflow", "wisprflow-meeting-brief"])
    expect(loaded.skills.map((skill): string => skill.path)).toEqual(SKILL_NAMES.map((name) => join(directory, name, "SKILL.md")))
    expect(loaded.problems).toEqual([])
  })

  test("a missing or broken skill becomes a problem for status, not a setup failure", async () => {
    const directory = skills({ wisprflow: "---\nname: wisprflow\n---\n" })
    expect(await loadSkills(directory)).toEqual({
      skills: [],
      problems: [
        'SKILLS_INVALID: The "wisprflow" skill was not loaded: skills/wisprflow/SKILL.md has no description. Next step: Reinstall the plugin.',
        'SKILLS_INVALID: The "wisprflow-meeting-brief" skill was not loaded: skills/wisprflow-meeting-brief/SKILL.md is missing. Next step: Reinstall the plugin.',
      ],
    })
  })

  test("an unreadable skill file is reported as unreadable, not missing", async () => {
    const directory = skills({ "wisprflow-meeting-brief": "---\nname: wisprflow-meeting-brief\ndescription: d\n---\n" })
    mkdirSync(join(directory, "wisprflow", "SKILL.md"), { recursive: true })
    expect((await loadSkills(directory)).problems).toEqual([
      'SKILLS_INVALID: The "wisprflow" skill was not loaded: skills/wisprflow/SKILL.md cannot be read (EISDIR). Next step: Reinstall the plugin.',
    ])
  })

  test("registers every loaded skill", async () => {
    const added: string[] = []
    await registerSkills(
      { transform: async (callback) => (callback({ add: (skill: { id: string }) => void added.push(skill.id) } as never), { dispose: async () => {} }) },
      [parseSkill("wisprflow", "/x", "---\nname: wisprflow\ndescription: d\n---\n")],
    )
    expect(added).toEqual(["wisprflow"])
  })
})
