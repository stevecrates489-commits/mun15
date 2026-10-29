/* Command-line verification of the wallpaper paint model.
   Run: node tmp-verify/paint.test.mts   (node 24 strips the types natively)

   The HSV->RGB checks cross the module against an INDEPENDENT reference
   implementation (the q/p formulation) over a grid of colours, so a bug in
   one of them cannot hide. */
import {
  hexToHsv, hsvToHex, hsvToHex8, hsvToCss,
  gradientCss, paintCss, paintLabel, parsePaint, isHsv,
  DEFAULT_WALL_COLOR, DEFAULT_WALL_GRADIENT,
  type Paint, type Hsv,
} from '../src/lib/color.ts'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${JSON.stringify(got)}\n       want: ${JSON.stringify(want)}`) }
}
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}

/* independent reference: HSV -> RGB via q/p (Wikipedia formulation) */
function refHsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const hh = ((((h % 360) + 360) % 360) / 60)
  const c = v * s
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = v - c
  const seg = Math.floor(hh) % 6
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ]
  const [r, g, b] = table[seg]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
const refHex6 = (c: Hsv) =>
  '#' + refHsvToRgb(c).map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()

console.log('\n[1] hex <-> hsv')
const cyan: Hsv = { h: 187, s: 1, v: 1, a: 1 }
eq('cyan -> hex8', hsvToHex8(cyan), '#00E1FFFF')
eq('cyan -> hex6', hsvToHex(cyan), '#00E1FF')
{
  const back = hexToHsv('#00E1FFFF')!
  ok('hex8 -> hsv (hue within rounding)', Math.abs(back.h - 187) < 0.5, `h=${back.h}`)
  eq('hex8 -> hsv (s/v/a exact)', [back.s, back.v, back.a], [1, 1, 1])
}
eq('short hex -> hsv (#0AF = #00AAFF)', hexToHsv('#0AF'), { h: 200, s: 1, v: 1, a: 1 })
eq('alpha rounded to 3dp', hexToHsv('#00E1FF80')?.a, 0.502)
eq('invalid hex -> null', hexToHsv('nope'), null)
eq('odd-length hex -> null', hexToHsv('#12345'), null)
eq('pure red', hsvToHex({ h: 0, s: 1, v: 1, a: 1 }), '#FF0000')
eq('pure green', hsvToHex({ h: 120, s: 1, v: 1, a: 1 }), '#00FF00')
eq('pure blue', hsvToHex({ h: 240, s: 1, v: 1, a: 1 }), '#0000FF')
eq('white', hsvToHex({ h: 0, s: 0, v: 1, a: 1 }), '#FFFFFF')
eq('black', hsvToHex({ h: 0, s: 0, v: 0, a: 1 }), '#000000')

console.log('\n[2] module vs independent reference (600 colours)')
{
  let mismatches = 0
  let firstBad = ''
  for (let i = 0; i < 600; i++) {
    const c: Hsv = {
      h: (i * 37) % 360,
      s: ((i * 13) % 100) / 100,
      v: ((i * 7) % 100) / 100,
      a: 1,
    }
    const mine = hsvToHex(c)
    const theirs = refHex6(c)
    if (mine !== theirs) { mismatches++; if (!firstBad) firstBad = `${JSON.stringify(c)} ${mine} != ${theirs}` }
  }
  ok('600/600 colours match the reference', mismatches === 0, firstBad)
}

console.log('\n[3] solid paint')
const solid: Paint = { kind: 'solid', color: cyan }
eq('paintCss solid', paintCss(solid), 'rgba(0,225,255,1)')
eq('paintLabel solid', paintLabel(solid), 'SOLID #00E1FF')
eq('hsvToCss clamps alpha', hsvToCss({ ...cyan, a: 1.7 }), 'rgba(0,225,255,1)')

console.log('\n[4] gradient css + angle normalisation')
const grad = { from: cyan, to: { h: 206, s: 0.823, v: 0.451, a: 1 }, angle: 135 }
eq('gradientCss', gradientCss(grad), 'linear-gradient(135deg, rgba(0,225,255,1), rgba(20,74,115,1))')
eq('angle 360 -> 0', gradientCss({ ...grad, angle: 360 }), 'linear-gradient(0deg, rgba(0,225,255,1), rgba(20,74,115,1))')
eq('angle -45 -> 315', gradientCss({ ...grad, angle: -45 }), 'linear-gradient(315deg, rgba(0,225,255,1), rgba(20,74,115,1))')
eq('angle 725 -> 5', gradientCss({ ...grad, angle: 725 }), 'linear-gradient(5deg, rgba(0,225,255,1), rgba(20,74,115,1))')
eq('angle fractional rounds', gradientCss({ ...grad, angle: 134.6 }), 'linear-gradient(135deg, rgba(0,225,255,1), rgba(20,74,115,1))')
eq('paintCss gradient', paintCss({ kind: 'gradient', gradient: grad }), gradientCss(grad))
eq('paintLabel gradient', paintLabel({ kind: 'gradient', gradient: grad }), 'GRADIENT #00E1FF → #144A73')

console.log('\n[5] parsePaint — persistence + corruption tolerance')
eq('null raw -> null', parsePaint(null), null)
eq('empty raw -> null', parsePaint(''), null)
eq('corrupt json -> null', parsePaint('{not json'), null)
eq('wrong kind -> null', parsePaint(JSON.stringify({ kind: 'plaid' })), null)
eq('solid missing colour -> null', parsePaint(JSON.stringify({ kind: 'solid' })), null)
eq('gradient missing stop -> null', parsePaint(JSON.stringify({ kind: 'gradient', gradient: { from: cyan } })), null)
eq('solid round trip', parsePaint(JSON.stringify(solid)), solid)
eq('gradient round trip', parsePaint(JSON.stringify({ kind: 'gradient', gradient: grad })), { kind: 'gradient', gradient: grad })
eq('missing angle -> default', parsePaint(JSON.stringify({ kind: 'gradient', gradient: { from: cyan, to: grad.to } })),
  { kind: 'gradient', gradient: { from: cyan, to: grad.to, angle: DEFAULT_WALL_GRADIENT.angle } })
eq('NaN angle -> default', parsePaint(JSON.stringify({ kind: 'gradient', gradient: { from: cyan, to: grad.to, angle: 'x' } })),
  { kind: 'gradient', gradient: { from: cyan, to: grad.to, angle: DEFAULT_WALL_GRADIENT.angle } })

console.log('\n[6] type guard + defaults')
ok('isHsv accepts a real colour', isHsv(cyan))
ok('isHsv rejects null', !isHsv(null))
ok('isHsv rejects partial', !isHsv({ h: 1, s: 1, v: 1 }))
ok('isHsv rejects string', !isHsv('#fff'))
eq('default colour matches reference', hsvToHex(DEFAULT_WALL_COLOR), refHex6(DEFAULT_WALL_COLOR))
ok('default colour is a violet (blue > green)', hsvToRgbRef(DEFAULT_WALL_COLOR)[2] > hsvToRgbRef(DEFAULT_WALL_COLOR)[1])
eq('default gradient shares the violet stop', DEFAULT_WALL_GRADIENT.from, DEFAULT_WALL_COLOR)
eq('default gradient angle', DEFAULT_WALL_GRADIENT.angle, 135)

function hsvToRgbRef(c: Hsv) { return refHsvToRgb(c) }

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail ? 1 : 0
