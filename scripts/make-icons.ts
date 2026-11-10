/**
 * Rasterize public/icons/app-icon.svg into every PWA / iOS / Android icon
 * the platform ships. Run once: `bun scripts/make-icons.ts`
 */
import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { join } from 'path'

const ROOT = join(process.cwd(), 'public', 'icons')
const svg = await readFile(join(ROOT, 'app-icon.svg'))

const targets: Array<[string, number, boolean]> = [
  // [filename, size, addTransparentPaddingForMaskable]
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-192.png', 192, true],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['icon-1024.png', 1024, false], // used by the Expo / native app
]

for (const [name, size, pad] of targets) {
  // Maskable icons need a safe zone: render the tile at 80% so OS crop never
  // clips the monogram.
  const inner = pad ? Math.round(size * 0.8) : size
  const tile = await sharp(svg).resize(inner, inner).png().toBuffer()
  const img = pad
    ? await sharp({
        create: { width: size, height: size, channels: 4, background: { r: 34, g: 53, b: 88, alpha: 1 } },
      })
        .composite([{ input: tile, gravity: 'center' }])
        .png()
        .toBuffer()
    : tile
  await sharp(img).toFile(join(ROOT, name))
  console.log(`✓ ${name} (${size}px${pad ? ', maskable' : ''})`)
}
