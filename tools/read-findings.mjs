// One-off: pull the ranked findings out of a workflow result payload.
import fs from 'node:fs'

const path = process.argv[2]
const raw = fs.readFileSync(path, 'utf8')
const start = raw.indexOf('{"audits"')

let depth = 0
let end = -1
let inStr = false
let esc = false
for (let k = start; k < raw.length; k++) {
  const ch = raw[k]
  if (inStr) {
    if (esc) esc = false
    else if (ch === String.fromCharCode(92)) esc = true
    else if (ch === '"') inStr = false
    continue
  }
  if (ch === '"') { inStr = true; continue }
  if (ch === '{') depth++
  else if (ch === '}') { depth--; if (depth === 0) { end = k + 1; break } }
}

const obj = JSON.parse(raw.slice(start, end))
const all = []
for (const a of obj.audits) for (const f of a.findings ?? []) all.push({ slice: a.label, ...f })
for (const f of obj.criticFindings ?? []) all.push({ slice: 'CRITIC', ...f })

const order = { critical: 0, major: 1, minor: 2 }
all.sort((a, b) => order[a.severity] - order[b.severity])
fs.writeFileSync('.shots/findings.json', JSON.stringify(all, null, 1))
console.log('TOTAL', all.length)
for (const f of all) {
  const line = [f.severity.padEnd(8), (f.slice ?? '').padEnd(14), (f.file + ':' + f.line).padEnd(42), f.category.padEnd(17)]
  console.log(line.join(' | ') + ' | ' + f.summary.slice(0, 110))
}
