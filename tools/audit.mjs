/* ============================================================================
   LUMINA STATIC QUALITY GATE
   ----------------------------------------------------------------------------
   Catches the mistakes that survive typechecking because they are not type
   errors: broken animations, hard-coded design values, inaccessible controls,
   dead imports, untyped escapes.

   Run:  node tools/audit.mjs [--quiet]

   Every source-text check runs over a COMMENT-STRIPPED copy of the tree. The
   previous version grepped raw files and so flagged prose — a comment saying
   "the <img> here is eight lines" read as an image with no alt, and a comment
   mentioning <IconButton read as an unlabelled control. A gate that cries wolf
   gets ignored, which is worse than no gate.
   ========================================================================== */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const QUIET = process.argv.includes('--quiet')

let failedGroups = 0
const findings = []

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* --- strip comments while preserving line numbering -------------------------
   A regex is wrong here (strings and regex literals contain "//" and "/*"),
   but a full tokenizer is overkill: we only need to avoid matching PROSE, and
   preserving offsets keeps the reported line numbers true. */
function stripComments(text) {
  let out = ''
  let i = 0
  const n = text.length
  let state = 'code' // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n' }
      else out += ' '
      i++; continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++; continue
    }
    // inside a string literal
    if (c === '\\') { out += '  '; i += 2; continue }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    out += c === '\n' ? '\n' : ' '
    i++
  }
  return out
}

const ALL = walk(SRC)
const files = {
  css: ALL.filter((f) => f.endsWith('.module.css')),
  tsx: ALL.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts')),
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/')

/** Scan `text` for occurrences of `open`, returning the full JSX opening tag. */
function jsxTags(text, open) {
  const hits = []
  let idx = 0
  while (true) {
    const at = text.indexOf(open, idx)
    if (at === -1) break
    // must be a tag, not part of a longer identifier
    const after = text[at + open.length]
    if (after && /[A-Za-z0-9_]/.test(after)) { idx = at + open.length; continue }
    // walk forward to the matching '>' at depth 0, respecting {} and strings
    let i = at + open.length
    let depth = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>') {
        if (depth <= 0) break
      } else if (c === '/' && text[i + 1] === '>') { i++; break }
    }
    hits.push({ at, tag: text.slice(at, Math.min(i + 1, text.length)) })
    idx = at + open.length
  }
  return hits
}

const lineOf = (text, at) => text.slice(0, at).split('\n').length

function section(title) {
  if (!QUIET) process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`)
}
function fail(msg) {
  findings.push(msg)
  if (!QUIET) process.stdout.write(`  \x1b[31m✗\x1b[0m ${msg}\n`)
}
function pass(msg) {
  if (!QUIET) process.stdout.write(`  \x1b[32m✓\x1b[0m ${msg}\n`)
}
function group() {
  if (findings.length > failedGroupsAtStart + 0) { /* placeholder */ }
}

/* =========================================================== 1. ANIMATIONS == */
section('1. Animation keyframes (CSS Modules mangle bare names)')
{
  const before = findings.length
  const BARE = /(?:^|[\s;])(spin|fade-in|fade-out|pop-in|slide-up|heart-burst|shimmer|scrim-in|skeleton-pulse)(?=[\s;,)]|$)/
  for (const f of files.css) {
    const text = fs.readFileSync(f, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, n) => {
      const decl = line.match(/^\s*animation(-name)?\s*:\s*(.+)$/)
      if (!decl) return
      // var(--anim-x) indirection is the only correct form
      if (/var\(\s*--anim-/.test(decl[2])) return
      if (BARE.test(decl[2])) fail(`${rel(f)}:${n + 1}  bare keyframe in "${decl[0].trim()}" — use var(--anim-*)`)
    })
  }
  if (findings.length === before) pass('every shared keyframe goes through var(--anim-*)')
  else failedGroups++
}

/* ============================================================== 2. COLOURS == */
section('2. Hard-coded colours in CSS Modules (should be design tokens)')
{
  const before = findings.length
  for (const f of files.css) {
    const text = fs.readFileSync(f, 'utf8')
    text.split('\n').forEach((line, n) => {
      if (/^\s*(\/\*|\*)/.test(line)) return
      const hits = line.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)
      if (!hits) return
      // var() fallbacks legitimately spell out a colour as the last resort
      const withoutFallbacks = line.replace(/var\([^)]*\)/g, '')
      const real = withoutFallbacks.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)
      if (real) fail(`${rel(f)}:${n + 1}  ${real.join(', ')}  →  ${line.trim().slice(0, 80)}`)
    })
  }
  if (findings.length === before) pass('no hard-coded colours outside var() fallbacks')
  else failedGroups++
}

/* =============================================================== 3. Z-INDEX == */
section('3. Global-layer z-index values (small ints are local stacking, fine)')
{
  const before = findings.length
  for (const f of files.css) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, n) => {
      const m = line.match(/z-index\s*:\s*(\d+)/)
      if (m && Number(m[1]) >= 100 && !/var\(--z-/.test(line)) {
        fail(`${rel(f)}:${n + 1}  z-index: ${m[1]}  →  use a --z-* token`)
      }
    })
  }
  if (findings.length === before) pass('all z-index values come from --z-* tokens')
  else failedGroups++
}

/* ==================================================== 4. ACCESSIBLE NAMES ==== */
section('4. Icon-only controls without an accessible name')
{
  const before = findings.length
  for (const f of files.tsx) {
    const raw = fs.readFileSync(f, 'utf8')
    const text = stripComments(raw)
    for (const { at, tag } of jsxTags(text, '<IconButton')) {
      if (/\blabel\s*=/.test(tag)) continue
      if (/\baria-label\s*=/.test(tag)) continue
      if (/>\s*\S/.test(tag.replace(/\/>$/, ''))) continue // has visible text children
      fail(`${rel(f)}:${lineOf(text, at)}  <IconButton> with no label prop`)
    }
  }
  if (findings.length === before) pass('every <IconButton> is named')
  else failedGroups++
}

/* ============================================================= 5. IMG ALT ==== */
section('5. Images without alt')
{
  const before = findings.length
  for (const f of files.tsx) {
    const raw = fs.readFileSync(f, 'utf8')
    const text = stripComments(raw)
    for (const { at, tag } of jsxTags(text, '<img')) {
      if (/\balt\s*=/.test(tag)) continue
      fail(`${rel(f)}:${lineOf(text, at)}  <img> with no alt`)
    }
  }
  if (findings.length === before) pass('every <img> has an alt')
  else failedGroups++
}

/* ==================================================== 6. Scaffolding / ANY === */
section('6. Leftover scaffolding')
{
  const before = findings.length
  for (const f of files.tsx) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    text.split('\n').forEach((line, n) => {
      if (/\b(TODO|FIXME|XXX:|HACK:)\b/.test(line)) fail(`${rel(f)}:${n + 1}  ${line.trim().slice(0, 70)}`)
    })
  }
  for (const f of ALL) {
    if (/\.(orig|bak|tmp|rej)$/.test(f) || /probe|scratch/i.test(path.basename(f))) {
      fail(`${rel(f)}  stray file`)
    }
  }
  if (findings.length === before) pass('no TODO/FIXME/stray files')
  else failedGroups++
}

section('7. Untyped "any" in TypeScript')
{
  const before = findings.length
  for (const f of files.tsx) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    text.split('\n').forEach((line, n) => {
      if (/:\s*any\b|\bas any\b|<any>/.test(line)) fail(`${rel(f)}:${n + 1}  ${line.trim().slice(0, 70)}`)
    })
  }
  if (findings.length === before) pass('no untyped any')
  else failedGroups++
}

/* =========================================================== 8. DEAD IMPORTS == */
section('8. Relative imports that do not resolve')
{
  const before = findings.length
  for (const f of files.tsx) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    const re = /from\s+['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(text))) {
      if (!m[1].startsWith('.')) continue
      const t = path.resolve(path.dirname(f), m[1])
      if (fs.existsSync(t)) continue
      const ok = fs.existsSync(t + '.ts') || fs.existsSync(t + '.tsx') ||
        fs.existsSync(path.join(t, 'index.ts')) || fs.existsSync(path.join(t, 'index.tsx'))
      if (!ok) fail(`${rel(f)}:${lineOf(text, m.index)}  ->  ${m[1]}`)
    }
  }
  if (findings.length === before) pass('every relative import resolves')
  else failedGroups++
}

/* ======================================================== 9. EXTERNAL ASSETS == */
section('9. External network resources (all imagery must be procedural)')
{
  const before = findings.length
  for (const f of files.tsx) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    const re = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi
    let m
    while ((m = re.exec(text))) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(m[0])) continue
      fail(`${rel(f)}:${lineOf(text, m.index)}  external URL ${m[0]}`)
    }
  }
  if (findings.length === before) pass('no external URLs')
  else failedGroups++
}

/* ========================================================== 10. TYPESCRIPT === */
section('10. TypeScript')
{
  // npx is a shell script on POSIX and a .cmd shim on Windows; spawnSync needs
  // a shell to launch either, otherwise it fails with empty output.
  const { spawnSync } = await import('node:child_process')
  const args = '-p tsconfig.app.json --noEmit'
  const cmd = process.platform === 'win32' ? `npx.cmd tsc ${args}` : `npx tsc ${args}`
  if (!QUIET) process.stdout.write('  running tsc...\n')
  const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true })
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  if (r.status === 0) {
    pass('no type errors')
  } else {
    failedGroups++
    if (!QUIET && out) out.split('\n').slice(0, 40).forEach((l) => fail(l))
    else if (!QUIET) fail('tsc exited non-zero with no output (harness failure, not a type error)')
  }
}

/* ======================================================== 11. CODE SPLITTING === */
section('11. Code splitting')
{
  // Two warnings that mean the lazy() routes are not actually splitting, and
  // both are invisible to tsc. They cost a real chunk graph once already:
  //
  //   "X was reexported through Y while both modules are dependencies of each
  //    other"   — a barrel whose re-exports land in different chunks. Rollup
  //                 says it will "likely lead to broken execution order".
  //   "X is dynamically imported by Y but also statically imported by Z" —
  //                 the page is already in the entry chunk, so the route load
  //                 fetches nothing.
  //
  // Both come from the same mistake: a module that lives in the shell importing
  // something a lazy route owns. Fix by naming the concrete module, not the
  // barrel — see the header of src/modules/feed/index.ts.
  const { spawnSync } = await import('node:child_process')
  if (!QUIET) process.stdout.write('  building...\n')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const r = spawnSync(`${npm} run build`, { cwd: ROOT, encoding: 'utf8', shell: true })
  const out = `${r.stdout || ''}${r.stderr || ''}`

  if (r.status !== 0) {
    failedGroups++
    if (!QUIET) fail('build failed — see the build output above')
  } else {
    const before = findings.length
    const rules = [
      {
        re: /was reexported through module/,
        label: 'circular chunk: a barrel re-exported across chunk boundaries',
      },
      {
        re: /is dynamically imported by .* but also statically imported by/,
        label: 'a lazy route is statically imported, so it is not code-split',
      },
    ]
    for (const { re, label } of rules) {
      const hits = out
        .split('\n')
        .filter((l) => re.test(l))
        .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
      // De-duplicate: Rollup repeats the same line for every re-export edge.
      for (const hit of [...new Set(hits)]) findings.push({ file: 'vite build', line: 0, message: `${label}: ${hit}` })
    }
    if (findings.length === before) pass('every lazy route is a real chunk, no circular chunks')
    else {
      failedGroups++
      if (!QUIET) {
        for (const f of findings.slice(before)) fail(f.message)
        process.stdout.write(
          '  -> import the concrete module rather than a barrel; a shell module\n' +
            '     importing a lazy route\'s module is what causes both of these.\n',
        )
      }
    }
  }
}

process.stdout.write('\n')
if (failedGroups === 0) process.stdout.write('\x1b[32mAll checks passed.\x1b[0m\n')
else process.stdout.write(`\x1b[31m${failedGroups} check group(s) failed, ${findings.length} finding(s).\x1b[0m\n`)
process.exit(failedGroups === 0 ? 0 : 1)
