// The skills loader: every shipped `skills/<name>/SKILL.md` parses, and a broken one fails with the contract's code and
// a next step rather than loading a partial set. The host test proves the same files are registered in OpenCode 2.4.1.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadSkills, parseSkill, SKILLS_DIR } from "../../src/skills.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))
const work = mkdtempSync(join(tmpdir(), "wisprflow-skills-"))
after(() => rmSync(work, { recursive: true, force: true }))

const refused = (error: unknown): error is Error =>
  error instanceof Error && error.message.startsWith("OPTIONS_INVALID: ") && error.message.includes(". Next step: ")

test("every skills/<name>/SKILL.md parses, and its name is its folder", async () => {
  const folders = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.ok(folders.length > 0, "the package ships at least one skill")
  const skills = await loadSkills()
  assert.deepEqual(
    skills.map((skill) => skill.id),
    folders,
  )
  for (const skill of skills) {
    assert.equal(skill.name, skill.id)
    assert.ok(skill.description !== undefined && skill.description.length > 0 && skill.description.length <= 300, `${skill.id} has a description of at most 300 characters`)
    assert.ok(skill.content.length > 0, `${skill.id} has content`)
    assert.equal(skill.path, join(root, "skills", skill.id, "SKILL.md"))
  }
})

test("a folded description is one line", () => {
  const skill = parseSkill(
    "wisprflow",
    join(SKILLS_DIR, "wisprflow", "SKILL.md"),
    "---\nname: wisprflow\ndescription: >\n  Read the meetings Wispr Flow captured:\n  transcripts and summaries.\n---\n\n# Wispr Flow\n",
  )
  assert.equal(skill.description, "Read the meetings Wispr Flow captured: transcripts and summaries.")
  assert.equal(skill.content, "# Wispr Flow")
})

test("a literal description keeps its lines", () => {
  const skill = parseSkill(
    "wisprflow",
    join(SKILLS_DIR, "wisprflow", "SKILL.md"),
    "---\nname: wisprflow\ndescription: |\n  Read the meetings Wispr Flow captured.\n  Then summarise them.\n---\n\n# Wispr Flow\n",
  )
  assert.equal(skill.description, "Read the meetings Wispr Flow captured.\nThen summarise them.")
  assert.equal(skill.content, "# Wispr Flow")
})

test("a block description indented by four spaces is dedented", () => {
  const skill = parseSkill(
    "wisprflow",
    join(SKILLS_DIR, "wisprflow", "SKILL.md"),
    "---\nname: wisprflow\ndescription: >\n    Read the meetings Wispr Flow captured.\n    Then summarise them.\n---\n\n# Wispr Flow\n",
  )
  assert.equal(skill.description, "Read the meetings Wispr Flow captured. Then summarise them.")
})

test("a quoted block marker is refused with OPTIONS_INVALID and a next step", () => {
  assert.throws(
    () => parseSkill("wisprflow", join(SKILLS_DIR, "wisprflow", "SKILL.md"), "---\nname: wisprflow\ndescription: '>'\n---\nBody.\n"),
    (error: unknown) => refused(error) && error.message.includes("block marker"),
  )
})

test("a name that is not the folder is refused with OPTIONS_INVALID and a next step", () => {
  assert.throws(
    () => parseSkill("wisprflow", join(SKILLS_DIR, "wisprflow", "SKILL.md"), "---\nname: other\ndescription: A skill.\n---\nBody.\n"),
    (error: unknown) => refused(error) && error.message.includes('must be named "wisprflow"'),
  )
})

test("a missing description is refused with OPTIONS_INVALID and a next step", () => {
  assert.throws(
    () => parseSkill("wisprflow", join(SKILLS_DIR, "wisprflow", "SKILL.md"), "---\nname: wisprflow\n---\nBody.\n"),
    (error: unknown) => refused(error) && error.message.includes("has no description"),
  )
})

test("an empty body is refused with OPTIONS_INVALID and a next step", () => {
  assert.throws(
    () => parseSkill("wisprflow", join(SKILLS_DIR, "wisprflow", "SKILL.md"), "---\nname: wisprflow\ndescription: A skill.\n---\n\n"),
    (error: unknown) => refused(error) && error.message.includes("has no content"),
  )
})

test("a folder without SKILL.md fails the load, naming the file", async () => {
  const directory = join(work, "skills")
  mkdirSync(join(directory, "wisprflow"), { recursive: true })
  await assert.rejects(loadSkills(directory), (error: unknown) => refused(error) && error.message.includes("skills/wisprflow/SKILL.md is missing"))
})

test("a file that does not parse fails the load instead of loading the others", async () => {
  const directory = join(work, "broken")
  mkdirSync(join(directory, "wisprflow"), { recursive: true })
  writeFileSync(join(directory, "wisprflow", "SKILL.md"), "---\nname: wisprflow\ndescription: A skill.\n---\nBody.\n")
  mkdirSync(join(directory, "wisprflow-other"), { recursive: true })
  writeFileSync(join(directory, "wisprflow-other", "SKILL.md"), "# No frontmatter\n")
  await assert.rejects(loadSkills(directory), (error: unknown) => refused(error) && error.message.includes('The "wisprflow-other" skill was not loaded'))
})

test("the shipped description is the frontmatter's, not the marker", () => {
  const text = readFileSync(join(SKILLS_DIR, "wisprflow", "SKILL.md"), "utf8")
  assert.notEqual(parseSkill("wisprflow", join(SKILLS_DIR, "wisprflow", "SKILL.md"), text).description, ">")
})
