import { useEffect, useRef } from 'react'

interface Props {
 /** Accent color for the pixel field (agent color). */
 color?: string
 /** 0-1 overall opacity of the layer. */
 opacity?: number
 className?: string
 /** Pause animation when false (saves CPU when tab not focused). */
 active?: boolean
}

/**
 * Lightweight PixelBlast-style background (react-bits inspired).
 * Canvas pixel grid + soft expanding blasts - no Three.js / Tailwind required.
 */
export function PixelBlast({
 color = '#22d3ee',
 opacity = 0.55,
 className = '',
 active = true
}: Props): JSX.Element {
 const canvasRef = useRef<HTMLCanvasElement>(null)
 const colorRef = useRef(color)
 colorRef.current = color

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
 type Pixel = { x: number; y: number; life: number; max: number; bright: number }
 type Blast = { x: number; y: number; r: number; maxR: number; life: number }
 const pixels: Pixel[] = []
 const blasts: Blast[] = []

 const parseRgb = (c: string): [number, number, number] => {
 // #rgb / #rrggbb
 const hex = c.trim()
 if (hex.startsWith('#')) {
 const h = hex.slice(1)
 if (h.length === 3) {
 return [
 parseInt(h[0] + h[0], 16),
 parseInt(h[1] + h[1], 16),
 parseInt(h[2] + h[2], 16)
 ]
 }
 if (h.length >= 6) {
 return [
 parseInt(h.slice(0, 2), 16),
 parseInt(h.slice(2, 4), 16),
 parseInt(h.slice(4, 6), 16)
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

 const seed = (): void => {
 pixels.length = 0
 const cols = Math.ceil(w / cell)
 const rows = Math.ceil(h / cell)
 const count = Math.min(180, Math.floor(cols * rows * 0.35))
 for (let i = 0; i < count; i++) {
 pixels.push({
 x: Math.floor(Math.random() * cols) * cell,
 y: Math.floor(Math.random() * rows) * cell,
 life: Math.random(),
 max: 0.4 + Math.random() * 0.8,
 bright: 0.15 + Math.random() * 0.85
 })
 }
 }

 const spawnBlast = (): void => {
 blasts.push({
 x: Math.random() * w,
 y: Math.random() * h,
 r: 2,
 maxR: 18 + Math.random() * 36,
 life: 1
 })
 }

 resize()
 seed()
 const ro = new ResizeObserver(() => {
 resize()
 seed()
 })
 if (canvas.parentElement) ro.observe(canvas.parentElement)

 let t = 0
 let nextBlast = 40

 const frame = (): void => {
 if (!alive) return
 raf = requestAnimationFrame(frame)
 t += 1
 if (t % 30 === 0) rgb = parseRgb(colorRef.current)
 const [cr, cg, cb] = rgb

 ctx.clearRect(0, 0, w, h)

 // Soft base shimmer
 for (const p of pixels) {
 p.life += 0.018 + p.bright * 0.012
 if (p.life > p.max) {
 p.life = 0
 p.x = Math.floor(Math.random() * Math.ceil(w / cell)) * cell
 p.y = Math.floor(Math.random() * Math.ceil(h / cell)) * cell
 p.bright = 0.2 + Math.random() * 0.8
 }
 const a = Math.sin((p.life / p.max) * Math.PI) * p.bright * 0.55
 if (a < 0.02) continue
 ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
 ctx.fillRect(p.x, p.y, cell - 1, cell - 1)
 }

 // Expanding pixel blasts
 if (t >= nextBlast) {
 spawnBlast()
 nextBlast = t + 50 + Math.floor(Math.random() * 90)
 }
 for (let i = blasts.length - 1; i >= 0; i--) {
 const b = blasts[i]
 b.r += 1.2
 b.life -= 0.022
 if (b.life <= 0 || b.r > b.maxR) {
 blasts.splice(i, 1)
 continue
 }
 const a = b.life * 0.45
 const step = cell
 for (let ang = 0; ang < Math.PI * 2; ang += 0.35) {
 const px = Math.floor((b.x + Math.cos(ang) * b.r) / step) * step
 const py = Math.floor((b.y + Math.sin(ang) * b.r) / step) * step
 ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
 ctx.fillRect(px, py, cell - 1, cell - 1)
 // fill ring interior lightly
 if (b.r > 6) {
 const px2 = Math.floor((b.x + Math.cos(ang) * (b.r - step)) / step) * step
 const py2 = Math.floor((b.y + Math.sin(ang) * (b.r - step)) / step) * step
 ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.35})`
 ctx.fillRect(px2, py2, cell - 1, cell - 1)
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
 }, [active])

 return (
 <canvas
 ref={canvasRef}
 className={`pixel-blast ${className}`.trim()}
 style={{ opacity }}
 aria-hidden
 />
 )
}
