#!/usr/bin/env node
/**
 * 从矢量源生成三平台图标（无网络、可复现）：
 *   build/resources/src/icon.svg         -> icon.png / icon.ico / icon.icns
 *   build/resources/src/trayTemplate.svg -> trayTemplate.png / trayTemplate@2x.png
 *
 * ICO/ICNS 都是容器格式，这里手写打包，避免引入图像工具链：
 * - ICO 用 PNG 压缩条目（Vista+），尺寸 16..256；
 * - ICNS 用 icp4/icp5/icp6/ic07..ic10 的 PNG 块。
 *
 * 用法: node scripts/build-icons.mjs [--check]
 *   --check 只校验已有产物是否齐全/尺寸正确，不重写文件。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'build', 'resources', 'src')
const OUT = join(REPO, 'build', 'resources')
const ICON_SVG = join(SRC, 'icon.svg')
const SMALL_SVG = join(SRC, 'icon-small.svg')
const TRAY_SVG = join(SRC, 'trayTemplate.svg')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_SIZES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

function pngFor(svgPath, size) {
  return sharp(readFileSync(svgPath), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** ICO：header + 目录项 + PNG 数据。 */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(16 * entries.length)
  let offset = 6 + directory.length
  entries.forEach(({ size, data }, index) => {
    const at = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, directory, ...entries.map(entry => entry.data)])
}

/** ICNS：'icns' + 总长度 + 若干 type/length/PNG 块。 */
function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 4, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

async function generate() {
  const png512 = await pngFor(ICON_SVG, 512)
  writeFileSync(join(OUT, 'icon.png'), png512)

  const icoEntries = []
  // 16/24/32 用放大主体的光学变体，避免小尺寸糊成一团。
  for (const size of ICO_SIZES) {
    icoEntries.push({ size, data: await pngFor(size <= 32 ? SMALL_SVG : ICON_SVG, size) })
  }
  writeFileSync(join(OUT, 'icon.ico'), buildIco(icoEntries))

  const icnsEntries = []
  for (const [type, size] of ICNS_SIZES) {
    icnsEntries.push({ type, data: await pngFor(size <= 32 ? SMALL_SVG : ICON_SVG, size) })
  }
  writeFileSync(join(OUT, 'icon.icns'), buildIcns(icnsEntries))

  writeFileSync(join(OUT, 'trayTemplate.png'), await pngFor(TRAY_SVG, 16))
  writeFileSync(join(OUT, 'trayTemplate@2x.png'), await pngFor(TRAY_SVG, 32))

  process.stdout.write(`icons: icon.png(512) icon.ico(${ICO_SIZES.join(',')}) icon.icns(${ICNS_SIZES.length}) tray(16/32)\n`)
}

function check() {
  const required = ['icon.png', 'icon.ico', 'icon.icns', 'trayTemplate.png', 'trayTemplate@2x.png']
  const missing = required.filter(name => !existsSync(join(OUT, name)))
  if (missing.length > 0) throw new Error(`缺少图标产物: ${missing.join(', ')}`)
  const png = readFileSync(join(OUT, 'icon.png'))
  if (png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) throw new Error('icon.png 不是 512x512')
  const ico = readFileSync(join(OUT, 'icon.ico'))
  if (ico.readUInt16LE(2) !== 1) throw new Error('icon.ico 类型不对')
  if (ico.readUInt16LE(4) !== ICO_SIZES.length) throw new Error('icon.ico 尺寸数量不对')
  const icns = readFileSync(join(OUT, 'icon.icns'))
  if (icns.toString('ascii', 0, 4) !== 'icns') throw new Error('icon.icns 头不对')
  if (icns.readUInt32BE(4) !== icns.length) throw new Error('icon.icns 长度字段不对')
  process.stdout.write('icons: 校验通过\n')
}

const checkOnly = process.argv.includes('--check')
if (checkOnly) check()
else {
  await generate()
  check()
}
