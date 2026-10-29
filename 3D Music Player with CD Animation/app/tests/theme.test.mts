/* Command-line verification of the wallpaper theme names + legacy migration.
   Run: node tmp-verify/theme.test.mts */
import { readSavedTheme, type Theme } from '../src/lib/theme.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`) }
}

console.log('\n[1] known themes survive verbatim')
for (const t of ['black', 'aurora', 'color', 'custom'] as Theme[]) {
  eq(`${t} -> ${t}`, readSavedTheme(t), t)
}

console.log('\n[2] the removed flat "gradient" preset migrates')
eq('gradient -> aurora', readSavedTheme('gradient'), 'aurora')

console.log('\n[3] unknown values fall back to null (caller picks its default)')
eq('null -> null', readSavedTheme(null), null)
eq('empty -> null', readSavedTheme(''), null)
eq('typo -> null', readSavedTheme('rainbow'), null)
eq('case matters -> null', readSavedTheme('Black'), null)
eq('whitespace -> null', readSavedTheme(' black '), null)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail ? 1 : 0
