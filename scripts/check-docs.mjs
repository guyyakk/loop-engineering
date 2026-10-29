// ตรวจกติกาของ Loop Engineering ส่วนที่ตรวจด้วยเครื่องได้ ใช้แค่ Node ไม่ต้องติดตั้ง package
// รัน: node scripts/check-docs.mjs [โฟลเดอร์ repo]   (ไม่ใส่ = repo ที่ไฟล์นี้อยู่)
// กติกาที่ตรวจอธิบายไว้ใน docs/LOOP_WORKFLOW.md หัวข้อ "ตรวจกติกาด้วยเครื่อง"
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** spec ที่ตั้งชื่อด้วยวันก่อนหน้านี้เขียนก่อนมีบรรทัด Status: และคำสถานะชุดนี้ จึงเก็บเป็นบันทึกเดิมโดยไม่บังคับรูปแบบใหม่ */
export const NEW_FORMAT_FROM = '2026-10-29'
export const SPEC_STATUSES = ['กำลังทำ', 'เสร็จ', 'เสร็จ–รอคนตรวจ', 'ติด blocker']
export const CHECK_STATUSES = ['Pass', 'Pass-จำลอง', 'ตรวจโดยคน', 'Not run', 'Fail']

const [WORKING, DONE, WAITING, BLOCKED] = SPEC_STATUSES
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-desktop', 'target'])
const SPEC_NAME = /^\d{4}-\d{2}-\d{2}-.+\.md$/
const CHECKBOX = /^[-*+]\s+\[([ xX])\]\s+(.*)$/
const LINK = /\]\(\s*<?([^)\s>]+)/g

/** เทียบคำโดยไม่สนขีดแบบต่าง ๆ ช่องว่าง ตัวพิมพ์เล็กใหญ่ และ markdown ที่ครอบอยู่ */
function norm(text) {
  return text
    .replace(/[*`]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const posix = (path) => path.split(sep).join('/')

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function listing(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** ตัด comment และ code block ออก เพราะไม่ใช่เนื้อหาที่กติกาพูดถึง */
function withoutHidden(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*(`{3,}|~{3,})[\s\S]*?^[ \t]*\1/gm, '')
}

/** ลิงก์ทุกอันในข้อความ ยกเว้นลิงก์ภายนอก (มี scheme) anchor และลิงก์ใน inline code */
function linksIn(text) {
  return [...text.replace(/`[^`\n]*`/g, '').matchAll(LINK)]
    .map((match) => match[1])
    .filter((target) => !/^([a-z][a-z0-9+.-]+:|#)/i.test(target))
}

/** path เต็มของไฟล์ที่ข้อความนี้ลิงก์ไปถึง */
function linkedPaths(file, text) {
  return linksIn(text).flatMap((target) => {
    try {
      const path = decodeURI(target.split(/[?#]/)[0])
      return path ? [resolve(dirname(file), path)] : []
    } catch {
      return []
    }
  })
}

/** ไฟล์ markdown ทั้ง repo ยกเว้นของที่ build ขึ้นมาและโฟลเดอร์ของเครื่องมือ (ขึ้นต้นด้วยจุด ยกเว้น .github) */
function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && (!entry.name.startsWith('.') || entry.name === '.github')) markdownFiles(join(dir, entry.name), out)
    } else if (entry.name.endsWith('.md')) out.push(join(dir, entry.name))
  }
  return out
}

/** หาไฟล์โดยเทียบชื่อทีละส่วนแบบตัวพิมพ์ตรง เพื่อให้ผลบน Windows เหมือนบน Linux ใน CI */
function lookup(root, path, listings) {
  let current = root
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    if (!listings.has(current)) listings.set(current, listing(current))
    const names = listings.get(current)
    if (!names.includes(part)) return names.some((name) => name.toLowerCase() === part.toLowerCase()) ? 'case' : 'missing'
    current = join(current, part)
  }
  return 'ok'
}

/** ปัญหาของลิงก์ หรือ null ถ้าใช้ได้ */
function linkProblem(root, file, target, listings) {
  if (/^[a-z]:[\\/]/i.test(target) || target.startsWith('\\\\')) return `ลิงก์ "${target}" เป็น path ของเครื่องนี้ ใช้ path แบบ relative แทน`
  let path
  try {
    path = decodeURI(target.split(/[?#]/)[0])
  } catch {
    return `ลิงก์ "${target}" เข้ารหัสไม่ถูกต้อง`
  }
  if (!path) return null
  const full = path.startsWith('/') ? join(root, path) : resolve(dirname(file), path)
  const inside = relative(root, full)
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return `ลิงก์ "${target}" ชี้ออกนอก repo`
  const found = lookup(root, full, listings)
  if (found === 'case') return `ลิงก์เสีย "${target}" — ตัวพิมพ์ไม่ตรงกับชื่อไฟล์จริง (Linux ใน CI จะหาไม่เจอ)`
  if (found === 'missing') return `ลิงก์เสีย "${target}" — ไม่มีไฟล์นี้`
  return null
}

/** แยกบรรทัดตามหัวข้อระดับ ## โดยใช้ชื่อหัวข้อที่ normalize แล้วเป็น key */
function sectionsOf(text) {
  const sections = new Map()
  let lines = null
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) sections.set(norm(heading[1]), (lines = []))
    else if (lines) lines.push(line)
  }
  return sections
}

/** ข้อในรายการติ๊กระดับบนสุด */
function checkboxes(lines) {
  return lines.flatMap((line) => {
    const match = line.match(CHECKBOX)
    return match ? [{ done: match[1] !== ' ', text: match[2].trim() }] : []
  })
}

/** ตาราง markdown ทุกตาราง เป็นแถวของเซลล์ (แถวแรกคือหัวตาราง ไม่รวมแถวขีด) */
function tablesOf(lines) {
  const tables = []
  let rows = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      rows = null
      continue
    }
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/(?<!\\)\|$/, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim())
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    if (!rows) tables.push((rows = []))
    rows.push(cells)
  }
  return tables
}

/** ชื่อแถวและค่าในคอลัมน์ Status ของทุกตารางที่มีคอลัมน์นี้ */
function statusCells(lines) {
  return tablesOf(lines).flatMap(([header, ...rows]) => {
    const column = header.findIndex((cell) => norm(cell) === 'status')
    return column < 0 ? [] : rows.map((row) => ({ row: row[0] ?? '', value: row[column] ?? '' }))
  })
}

/** รอบสูงสุดใน Loop log (แถวที่ไม่ใช่ตัวเลข เช่น "—" ไม่นับ) */
function maxRound(lines) {
  const rounds = tablesOf(lines).flatMap(([, ...rows]) =>
    rows.map((row) => row[0] ?? '').filter((cell) => /^\d+$/.test(cell)).map(Number),
  )
  return Math.max(-1, ...rounds)
}

function readSpec(path) {
  const text = withoutHidden(read(path))
  const sections = sectionsOf(text)
  const statusLine = text.match(/^\**Status\**\s*:\s*\**\s*(.*)$/m)
  const statusText = statusLine ? statusLine[1].trim() : null
  const humanText = norm((sections.get('ตรวจโดยคน') ?? []).join(' '))
  return {
    path,
    newFormat: basename(path).slice(0, 10) >= NEW_FORMAT_FROM,
    statusText,
    status: statusText === null ? null : (SPEC_STATUSES.find((status) => norm(status) === norm(statusText)) ?? 'invalid'),
    criteria: checkboxes(sections.get('acceptance criteria') ?? []).map((item) => ({
      ...item,
      id: item.text.match(/^\**\s*(AC\d+)\b/)?.[1] ?? null,
    })),
    checks: statusCells(sections.get('validation plan') ?? []),
    rounds: maxRound(sections.get('loop log') ?? []),
    human: humanText !== '' && humanText !== 'none',
  }
}

/** ข้อในรายการติ๊กของไฟล์ พร้อมรหัสเกณฑ์และ spec ที่ลิงก์ไป */
function checklistOf(file) {
  return checkboxes(withoutHidden(read(file)).split(/\r?\n/)).map((item) => ({
    ...item,
    id: item.text.match(/\bAC\d+\b/)?.[0] ?? null,
    paths: linkedPaths(file, item.text),
  }))
}

const label = (criterion) => criterion.id ?? `"${criterion.text.slice(0, 40)}"`

export function checkDocs(repo) {
  const root = resolve(repo)
  const problems = []
  const report = (file, message) => problems.push({ file: posix(relative(root, file)), message })

  // 1) ลิงก์ในไฟล์ markdown ทั้ง repo
  const listings = new Map()
  let links = 0
  for (const file of markdownFiles(root)) {
    for (const target of linksIn(withoutHidden(read(file)))) {
      links++
      const problem = linkProblem(root, file, target, listings)
      if (problem) report(file, problem)
    }
  }

  const tasks = join(root, 'docs', 'tasks')
  const specs = listing(tasks)
    .filter((name) => SPEC_NAME.test(name))
    .map((name) => readSpec(join(tasks, name)))
  const humanFile = join(root, 'docs', 'HUMAN_CHECKS.md')
  const human = checklistOf(humanFile)
  const retroFile = join(root, 'docs', 'RETRO.md')
  const retro = new Set(linkedPaths(retroFile, withoutHidden(read(retroFile))))

  for (const spec of specs) {
    const file = spec.path

    // 2) รูปแบบ spec: Status และคำสถานะ
    if (spec.status === 'invalid') {
      report(file, `Status "${spec.statusText}" ใช้ไม่ได้ — ใช้ได้: ${SPEC_STATUSES.join(', ')}`)
      continue
    }
    if (spec.newFormat) {
      if (spec.status === null) {
        report(file, `ไม่มีบรรทัด Status: (spec ตั้งแต่ ${NEW_FORMAT_FROM} ต้องมี)`)
        continue
      }
      for (const { row, value } of spec.checks) {
        if (!CHECK_STATUSES.some((status) => norm(status) === norm(value))) {
          report(file, `คำสถานะ "${value}" ในแถว "${row}" ใช้ไม่ได้ — ใช้ได้: ${CHECK_STATUSES.join(', ')}`)
        }
      }
    }

    // 3) Status ต้องตรงกับเกณฑ์ และผลที่คนต้องตรวจต่อต้องมีขั้นตอน
    //    (spec เดิมไม่มีหัวข้อ "ตรวจโดยคน" ขั้นตอนอยู่ใน Human decision needed จึงตรวจเฉพาะ spec ใหม่)
    const open = spec.criteria.filter((criterion) => !criterion.done)
    if (spec.status === DONE && open.length) report(file, `Status: ${DONE} แต่ยังมีเกณฑ์ที่ไม่ติ๊ก: ${open.map(label).join(', ')}`)
    if (spec.newFormat && !spec.human) {
      if (spec.status === WAITING) report(file, `Status: ${WAITING} แต่หัวข้อ "ตรวจโดยคน" ไม่มีขั้นตอน`)
      if (spec.checks.some(({ value }) => ['pass-จำลอง', 'ตรวจโดยคน'].includes(norm(value)))) {
        report(file, 'มีผลตรวจ Pass-จำลอง หรือ ตรวจโดยคน แต่หัวข้อ "ตรวจโดยคน" ไม่มีขั้นตอน')
      }
    }

    // 4) เกณฑ์ที่รอคนตรวจต้องอยู่ใน HUMAN_CHECKS (spec เดิมที่ไม่มี Status ถือว่าจบแล้ว)
    const items = human.filter((item) => item.paths.includes(file))
    const pending = items.filter((item) => !item.done)
    if (spec.status === null || spec.status === WAITING) {
      for (const criterion of open.filter((criterion) => criterion.id)) {
        const same = items.filter((item) => item.id === criterion.id)
        if (same.some((item) => !item.done)) continue
        report(
          file,
          same.length
            ? `เกณฑ์ ${criterion.id} ติ๊กใน docs/HUMAN_CHECKS.md แล้ว แต่ใน spec ยังไม่ติ๊ก`
            : `เกณฑ์ ${criterion.id} ยังไม่ติ๊ก แต่ไม่มีข้อค้างใน docs/HUMAN_CHECKS.md`,
        )
      }
      const unnamed = open.filter((criterion) => !criterion.id).length
      const unnamedPending = pending.filter((item) => !item.id).length
      if (unnamed > unnamedPending) {
        report(file, `มีเกณฑ์ไม่มีรหัสที่ยังไม่ติ๊ก ${unnamed} ข้อ แต่มีข้อค้างใน docs/HUMAN_CHECKS.md แค่ ${unnamedPending} ข้อ`)
      }
    }
    if (spec.status === WAITING && !pending.length) report(file, `Status: ${WAITING} แต่ไม่มีข้อค้างใน docs/HUMAN_CHECKS.md`)
    if (spec.status === DONE && pending.some((item) => !item.id)) report(file, `Status: ${DONE} แต่ docs/HUMAN_CHECKS.md ยังมีข้อค้างของ spec นี้`)

    // 5) loop ที่ไม่ราบรื่นต้องมีแถวใน RETRO
    if (spec.status !== WORKING) {
      const reasons = []
      if (spec.rounds >= 3) reasons.push('ครบ 3 รอบแก้')
      if (spec.status === BLOCKED) reasons.push('ติด blocker')
      if (spec.status === WAITING || spec.human || (spec.status === null && open.length)) reasons.push('มีข้อตรวจโดยคน')
      if (reasons.length && !retro.has(file)) report(file, `ต้องมีแถวใน docs/RETRO.md ที่ลิงก์มาที่ spec นี้ (${reasons.join(', ')})`)
    }
  }

  // 4) ทางกลับ: ข้อค้างใน HUMAN_CHECKS ต้องเป็นเกณฑ์ที่ยังไม่ติ๊กใน spec
  const bySpec = new Map(specs.map((spec) => [spec.path, spec]))
  for (const item of human) {
    if (item.done || !item.id) continue
    for (const path of item.paths) {
      const spec = bySpec.get(path)
      if (!spec) continue
      const criterion = spec.criteria.find((criterion) => criterion.id === item.id)
      const name = posix(relative(root, path))
      if (!criterion) report(humanFile, `อ้าง ${item.id} ซึ่งไม่มีใน ${name}`)
      else if (criterion.done) report(humanFile, `${item.id} ของ ${name} ติ๊กใน spec แล้ว แต่ที่นี่ยังไม่ติ๊ก`)
    }
  }

  return { problems, links, specs: specs.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { problems, links, specs } = checkDocs(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
  for (const { file, message } of problems) console.log(`${file}: ${message}`)
  console.log(
    problems.length
      ? `พบปัญหา ${problems.length} ข้อ — กติกาอยู่ใน docs/LOOP_WORKFLOW.md หัวข้อ "ตรวจกติกาด้วยเครื่อง"`
      : `ผ่าน: ลิงก์ ${links} ลิงก์, spec ${specs} ไฟล์`,
  )
  process.exitCode = problems.length ? 1 : 0
}
