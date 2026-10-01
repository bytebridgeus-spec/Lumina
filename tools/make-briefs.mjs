/* Turn the review wave's findings into per-slice fix briefs.
 *
 * Slices are grouped BY FILE so that no two agents can ever own the same file.
 * Any major whose file is not covered by a slice is reported at the end rather
 * than silently dropped, so "covered" never quietly means "some of it".
 */
import { readFileSync, writeFileSync } from 'node:fs'

const findings = JSON.parse(readFileSync('.shots/findings.json', 'utf8'))

/** Windows paths, relative to the repo, always with forward slashes. */
const rel = (p) => String(p).replace(/^.*?Instagram[\\/]/, '').split('\\').join('/')

const SLICES = [
  ['seed', ['src/data/seed.ts']],
  ['profile', ['src/modules/profile/ProfilePage.tsx', 'src/modules/profile/ProfileHeader.tsx']],
  ['menus', ['src/components/layout/MoreMenu.tsx', 'src/components/ui/ContextMenu.tsx', 'src/components/ui/Popover.tsx']],
  ['stories', ['src/modules/stories/StoryViewer.tsx', 'src/modules/stories/HighlightRail.tsx', 'src/components/ui/VideoPlayer.tsx']],
  ['search', ['src/modules/search/SearchPage.tsx', 'src/modules/search/ResultHashtagRow.tsx', 'src/store/selectors.ts']],
  ['shell', ['src/lib/hooks.ts', 'src/components/ui/ModalHost.tsx', 'src/components/layout/ActivityPanel.tsx', 'src/components/layout/SettingsPanel.tsx']],
  ['explore', ['src/modules/explore/ExploreDetail.tsx', 'src/modules/explore/ExplorePage.tsx', 'src/modules/post/ShareModal.tsx']],
  ['media', ['src/modules/feed/PostHeader.tsx', 'src/modules/reels/ReelPlayer.tsx', 'src/modules/reels/ReelPlayer.module.css', 'src/modules/misc/NotFoundPage.module.css']],
  ['store', ['src/modules/notifications/NotificationsPage.tsx', 'src/modules/auth/SignupPage.tsx', 'src/modules/dm/InboxPage.tsx', 'src/store/useAppStore.ts']],
]

const owned = new Set(SLICES.flatMap(([, files]) => files))

let out = `# MAJOR FINDINGS — FIX BRIEFS

Every finding below was produced by an independent adversarial reviewer of this
tree. Some may already be fixed in the working copy: **verify first**, and report
a finding as ALREADY-FIXED rather than editing it. A reviewer can be wrong; the
evidence in the tree outranks the claim in this file.
`

let assigned = 0

for (const [name, files] of SLICES) {
  const items = findings.filter((f) => f.severity === 'major' && files.includes(rel(f.file)))
  assigned += items.length

  out += `\n## SLICE ${name}\n\nYOU OWN EXACTLY THESE FILES. Do not edit any other file:\n`
  out += files.map((f) => `- ${f}`).join('\n') + '\n'

  items.forEach((f, i) => {
    out += `\n### ${name.toUpperCase()}-${i + 1}  (${f.severity}/${f.category})  ${rel(f.file)}:${f.line}\n`
    out += `\nSUMMARY: ${f.summary}\n`
    if (f.detail) out += `\nDETAIL:\n${f.detail}\n`
    if (f.fix) out += `\nSUGGESTED FIX FROM REVIEWER: ${f.fix}\n`
    if (f.failureScenario) out += `\nFAILURE SCENARIO: ${f.failureScenario}\n`
  })

  if (items.length === 0) out += '\n(no major findings in this slice)\n'
}

const majors = findings.filter((f) => f.severity === 'major')
const missing = [...new Set(majors.map((f) => rel(f.file)))].filter((f) => !owned.has(f))

out += `\n\n## COVERAGE\n\n${assigned} of ${majors.length} majors are assigned above.\n`
out += missing.length
  ? `\nUNASSIGNED MAJOR FILES — report these in your final answer, do NOT edit them:\n${missing.join('\n')}\n`
  : '\nEvery major is assigned. Nothing is unassigned.\n'

writeFileSync('tools/major-briefs.md', out)
console.log(`tools/major-briefs.md — ${assigned}/${majors.length} majors, ${SLICES.length} slices, ${missing.length} unassigned`)
