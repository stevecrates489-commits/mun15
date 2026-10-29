import { useEffect } from 'react'
import CreatorEye from './CreatorEye'

const ICONS = {
  telegram:
    'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
  instagram:
    'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z',
  discord:
    'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z',
  pinterest:
    'M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z',
}

const LINKS = [
  { name: 'Telegram', url: 'https://t.me/Oldnpx', icon: ICONS.telegram, angle: -90 },
  { name: 'Instagram', url: 'https://www.instagram.com/ar_yyn.m/', icon: ICONS.instagram, angle: 0 },
  { name: 'Discord', url: 'https://discord.com/users/1536421334685323304', icon: ICONS.discord, angle: 90 },
  { name: 'Pinterest', url: 'https://pin.it/1yTvpF3bk', icon: ICONS.pinterest, angle: 180 },
]

const C = 200, R_OUT = 188, R_IN = 104, ICON_R = (R_OUT + R_IN) / 2

function arcSegment(a0: number, a1: number, slant = 0): string {
  const p = (r: number, a: number) => [
    C + r * Math.cos((a * Math.PI) / 180),
    C + r * Math.sin((a * Math.PI) / 180),
  ]
  const [x0, y0] = p(R_OUT, a0)
  const [x1, y1] = p(R_OUT, a1)
  /* the inner edge is rotated forward — slanted turbine seams, not radial cuts */
  const [x2, y2] = p(R_IN, a1 + slant)
  const [x3, y3] = p(R_IN, a0 + slant)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R_OUT} ${R_OUT} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${R_IN} ${R_IN} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
}

/**
 * The CREATOR contact ring: a brushed-metal annulus with four segments —
 * Telegram, Instagram, Discord, Pinterest — and the three-pupil eye
 * floating in the center. Toggled only by the CREATOR button; while open
 * the rest of the player stays fully interactive.
 */
export default function CreatorMenu({
  closing,
  onClosed,
}: {
  closing: boolean
  onClosed: () => void
}) {
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(onClosed, 320)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  return (
    <>
      <div className="fixed z-[90]" style={{ right: 'calc(5% - 53px)', bottom: 'calc(13% + 50px)' }}>
        <div className={`relative ${closing ? 'creator-closing' : ''}`} style={{ width: 200, height: 200 }}>
          <svg
            viewBox="0 0 400 400"
            width={200}
            height={200}
            style={{ filter: 'drop-shadow(0 14px 26px rgba(0,0,0,0.75)) drop-shadow(0 0 18px rgba(120,160,255,0.12))' }}
          >
            <defs>
              <linearGradient id="cm-steel-a" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f2f5f8" />
                <stop offset="0.35" stopColor="#c3cbd4" />
                <stop offset="0.6" stopColor="#8f979f" />
                <stop offset="0.82" stopColor="#c9d1d9" />
                <stop offset="1" stopColor="#78808a" />
              </linearGradient>
              <linearGradient id="cm-steel-b" x1="1" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#eef1f5" />
                <stop offset="0.4" stopColor="#aeb7c1" />
                <stop offset="0.65" stopColor="#7d858f" />
                <stop offset="0.85" stopColor="#c4ccd4" />
                <stop offset="1" stopColor="#6d757f" />
              </linearGradient>
              <radialGradient id="cm-hole" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0.7" stopColor="rgba(0,0,0,0.85)" />
                <stop offset="1" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            </defs>

            {/* soft depth under the ring hole */}
            <circle cx={C} cy={C} r={R_IN + 8} fill="url(#cm-hole)" />

            {LINKS.map((l, i) => {
              const a0 = l.angle - 44
              const a1 = l.angle + 44
              const mid = (l.angle * Math.PI) / 180
              const ix = C + ICON_R * Math.cos(mid)
              const iy = C + ICON_R * Math.sin(mid)
              return (
                <g
                  key={l.name}
                  className="creator-seg cursor-pointer"
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={(e) => {
                    e.stopPropagation()
                    window.open(l.url, '_blank', 'noopener')
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.14)')}
                  onMouseLeave={(e) => (e.currentTarget.style.filter = '')}
                >
                  <title>{l.name}</title>
                  <path
                    d={arcSegment(a0, a1, 9)}
                    fill={i % 2 ? 'url(#cm-steel-a)' : 'url(#cm-steel-b)'}
                    stroke="#2c3138"
                    strokeOpacity={0.55}
                    strokeWidth={1}
                    strokeLinejoin="round"
                  />
                  <path
                    d={arcSegment(a0, a1, 9)}
                    fill="none"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={1.4}
                    style={{ mixBlendMode: 'screen', opacity: 0.5, transformOrigin: '200px 200px' }}
                    transform="scale(0.995)"
                  />
                  <g transform={`translate(${ix.toFixed(2)},${iy.toFixed(2)}) scale(1.6) translate(-12,-12)`} opacity={0.88}>
                    <path d={l.icon} fill="#24282e" />
                  </g>
                </g>
              )
            })}

            {/* inner + outer rims */}
            <circle cx={C} cy={C} r={R_IN + 2} fill="none" stroke="rgba(20,23,28,0.8)" strokeWidth={2.5} />
            <circle cx={C} cy={C} r={R_OUT - 1.5} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.2} />
            {/* slanted seams along each segment's trailing edge */}
            {LINKS.map((l) => {
              const [x1, y1] = [C + R_OUT * Math.cos(((l.angle + 44) * Math.PI) / 180), C + R_OUT * Math.sin(((l.angle + 44) * Math.PI) / 180)]
              const [x2, y2] = [C + R_IN * Math.cos(((l.angle + 53) * Math.PI) / 180), C + R_IN * Math.sin(((l.angle + 53) * Math.PI) / 180)]
              return (
                <line
                  key={l.name + '-seam'}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(20,23,28,0.65)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )
            })}
          </svg>

          {/* the eye in the center hole */}
          <div className="creator-eye absolute left-1/2 top-1/2">
            <div
              className="rounded-full"
              style={{
                boxShadow: 'inset 0 0 30px rgba(0,0,0,0.85), 0 0 40px rgba(0,0,0,0.6)',
                background: 'radial-gradient(circle at 50% 40%, #1a1114 0%, #050405 75%)',
              }}
            >
              <CreatorEye size={100} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
