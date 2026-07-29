/**
 * Rasterize resources/icon.svg → PNG sizes + Windows .ico for Electron.
 * Usage: node tools/generate-icons.mjs
 * Requires: npm i -D @resvg/resvg-js png-to-ico (or already installed)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Resvg } = require('@resvg/resvg-js')
const pngToIco = require('png-to-ico').default

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'resources', 'icon.svg')
const svg = readFileSync(svgPath)

const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const pngBySize = new Map()

mkdirSync(join(root, 'resources', 'icons'), { recursive: true })
mkdirSync(join(root, 'build'), { recursive: true })

for (const s of sizes) {
 const resvg = new Resvg(svg, {
 fitTo: { mode: 'width', value: s },
 background: 'rgba(0,0,0,0)'
 })
 const buf = Buffer.from(resvg.render().asPng())
 pngBySize.set(s, buf)
 writeFileSync(join(root, 'resources', 'icons', `icon-${s}.png`), buf)
 console.log(` icon-${s}.png ${buf.length} bytes`)
}

writeFileSync(join(root, 'resources', 'icon.png'), pngBySize.get(512))
writeFileSync(join(root, 'resources', 'icon-256.png'), pngBySize.get(256))
writeFileSync(join(root, 'build', 'icon.png'), pngBySize.get(512))

const ico = await pngToIco(icoSizes.map((s) => pngBySize.get(s)))
writeFileSync(join(root, 'resources', 'icon.ico'), ico)
writeFileSync(join(root, 'build', 'icon.ico'), ico)
console.log(` icon.ico ${ico.length} bytes`)
console.log('Done - resources/ + build/ updated from icon.svg')
