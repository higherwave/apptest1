// A small ZIP writer: every file deflated, names in UTF-8, nothing else. Enough for an export a person opens with any unzip tool, and nothing to
// install. (The reader in the tests is the check that it is a well-formed archive.)
import { deflateRawSync } from 'node:zlib'

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type ZipFile = { path: string; data: string | Buffer }

/** A path that stays inside the archive: forward slashes, no leading slash, no "..". */
export const safePath = (p: string) =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')

export function zip(files: ZipFile[], when: Date = new Date()): Buffer {
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1)
  const dosDate = (Math.max(0, when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(safePath(f.path), 'utf8')
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data
    const packed = deflateRawSync(raw)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, packed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4) // made by
    entry.writeUInt16LE(20, 6) // version needed
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(dosTime, 12)
    entry.writeUInt16LE(dosDate, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}
