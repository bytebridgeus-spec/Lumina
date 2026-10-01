// Resolve every relative import in src/ and report the ones that do not exist.
// tsc already catches these for TS paths, but CSS Modules and any barrel with a
// stale re-export are exactly the class of thing a bundler rejects at build
// time and nothing else catches.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p)
  }
  return out
}

const RE = /from\s+['"]([^'"]+)['"]/g
const missing = []
let checked = 0

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8')
  let m
  RE.lastIndex = 0
  while ((m = RE.exec(src))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue // @/ alias + bare packages: tsc covers those
    checked++
    const target = path.resolve(path.dirname(file), spec)
    if (fs.existsSync(target)) continue
    // Extensionless relative import: try .ts/.tsx/index.*
    const bare = fs.existsSync(target + '.ts') || fs.existsSync(target + '.tsx') ||
      fs.existsSync(path.join(target, 'index.ts')) || fs.existsSync(path.join(target, 'index.tsx'))
    if (bare) continue
    const line = src.slice(0, m.index).split('\n').length
    missing.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${line}  ->  ${spec}`)
  }
}

console.log(missing.length ? missing.join('\n') : 'all relative imports resolve')
console.log(`--- ${checked} relative imports checked, ${missing.length} missing`)
