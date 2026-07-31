import { useEffect, useRef } from 'react'

interface Props {
  /** Accent color for the pixel field (agent color). */
  color?: string
  /** 0-1 overall opacity of the layer. */
  opacity?: number
  className?: string
  /** Pause animation when false (saves CPU when tab not focused). */
  active?: boolean
  /**
   * When this value changes, re-seed a denser flicker (e.g. session open).
   */
  burstKey?: string | number
  /**
   * Expanding ring explosions. Default **false** — only soft pixel flicker.
   */
  explosions?: boolean
  /** @deprecated ignored — no explosion intro */
  introBlasts?: number
}

/**
 * Soft pixel-field flicker (react-bits style).
 * Default: twinkling cells only — no expanding blast rings.
 */
export function PixelBlast({
  color = '#22d3ee',
  opacity = 0.55,
  className = '',
  active = true,
  burstKey,
  explosions = false
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colorRef = useRef(color)
  colorRef.current = color
  const explosionsRef = useRef(explosions)
  explosionsRef.current = explosions

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let raf = 0
    let alive = true
    let w = 0
    let h = 0
    let dpr = 1
    const cell = 4
    type Pixel = {
      x: number
      y: number
      life: number
      max: number
      bright: number
      speed: number
    }
    type Blast = { x: number; y: number; r: number; maxR: number; life: number }
    const pixels: Pixel[] = []
    const blasts: Blast[] = []

    const parseRgb = (c: string): [number, number, number] => {
      const hex = c.trim()
      if (hex.startsWith('#')) {
        const hh = hex.slice(1)
        if (hh.length === 3) {
          return [
            parseInt(hh[0] + hh[0], 16),
            parseInt(hh[1] + hh[1], 16),
            parseInt(hh[2] + hh[2], 16)
          ]
        }
        if (hh.length >= 6) {
          return [
            parseInt(hh.slice(0, 2), 16),
            parseInt(hh.slice(2, 4), 16),
            parseInt(hh.slice(4, 6), 16)
          ]
        }
      }
      const m = c.match(/(\d+),\s*(\d+),\s*(\d+)/)
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
      return [34, 211, 238]
    }
    let rgb = parseRgb(colorRef.current)

    const resize = (): void => {
      const parent = canvas.parentElement
      if (!parent) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, parent.clientWidth)
      h = Math.max(1, parent.clientHeight)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const seed = (dense = false): void => {
      pixels.length = 0
      const cols = Math.max(1, Math.ceil(w / cell))
      const rows = Math.max(1, Math.ceil(h / cell))
      const density = dense ? 0.55 : 0.38
      const count = Math.min(dense ? 320 : 200, Math.floor(cols * rows * density))
      for (let i = 0; i < count; i++) {
        pixels.push({
          x: Math.floor(Math.random() * cols) * cell,
          y: Math.floor(Math.random() * rows) * cell,
          life: Math.random(),
          max: 0.35 + Math.random() * 0.9,
          bright: 0.2 + Math.random() * 0.85,
          speed: 0.012 + Math.random() * 0.028
        })
      }
    }

    resize()
    seed(true)
    const ro = new ResizeObserver(() => {
      resize()
      seed(false)
    })
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    let t = 0
    let nextBlast = 80
    // First ~1.2s: denser, faster flicker (loading feel)
    let denseUntil = 72

    const frame = (): void => {
      if (!alive) return
      raf = requestAnimationFrame(frame)
      t += 1
      if (t % 30 === 0) rgb = parseRgb(colorRef.current)
      const [cr, cg, cb] = rgb
      const dense = t < denseUntil

      ctx.clearRect(0, 0, w, h)

      // Twinkling pixel field only
      for (const p of pixels) {
        p.life += p.speed * (dense ? 1.35 : 1)
        if (p.life > p.max) {
          p.life = 0
          p.x = Math.floor(Math.random() * Math.ceil(w / cell)) * cell
          p.y = Math.floor(Math.random() * Math.ceil(h / cell)) * cell
          p.bright = 0.18 + Math.random() * 0.9
          p.speed = 0.012 + Math.random() * 0.028
          p.max = 0.3 + Math.random() * 0.95
        }
        // Sharp flicker: sin envelope + occasional sparkle
        const wave = Math.sin((p.life / p.max) * Math.PI)
        const spark = p.bright > 0.75 && (t + p.x + p.y) % 7 === 0 ? 0.35 : 0
        const a = Math.min(1, wave * p.bright * (dense ? 0.85 : 0.55) + spark)
        if (a < 0.03) continue
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
        ctx.fillRect(p.x, p.y, cell - 1, cell - 1)
      }

      // Optional expanding rings (off by default)
      if (explosionsRef.current) {
        if (t >= nextBlast) {
          blasts.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: 2,
            maxR: 18 + Math.random() * 28,
            life: 1
          })
          nextBlast = t + 60 + Math.floor(Math.random() * 100)
        }
        for (let i = blasts.length - 1; i >= 0; i--) {
          const b = blasts[i]
          b.r += 1.1
          b.life -= 0.024
          if (b.life <= 0 || b.r > b.maxR) {
            blasts.splice(i, 1)
            continue
          }
          const a = b.life * 0.4
          const step = cell
          for (let ang = 0; ang < Math.PI * 2; ang += 0.35) {
            const px = Math.floor((b.x + Math.cos(ang) * b.r) / step) * step
            const py = Math.floor((b.y + Math.sin(ang) * b.r) / step) * step
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
            ctx.fillRect(px, py, cell - 1, cell - 1)
          }
        }
      }
    }

    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [active, burstKey])

  return (
    <canvas
      ref={canvasRef}
      className={`pixel-blast ${className}`.trim()}
      style={{ opacity }}
      aria-hidden
    />
  )
}
