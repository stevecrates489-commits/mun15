export interface Tags {
  title?: string
  artist?: string
  cover?: string
}

async function readBytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer())
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 1 || encoding === 2) {
      /* UTF-16: honour the BOM; fall back to the ID3-declared endianness */
      let b = bytes
      let enc = 'utf-16le'
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) b = bytes.subarray(2)
      else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        b = bytes.subarray(2)
        enc = 'utf-16be'
      } else if (encoding === 2) enc = 'utf-16be'
      return new TextDecoder(enc).decode(b).split('\0')[0]
    }
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(bytes).split('\0')[0]
  } catch {
    return ''
  }
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  /* APIC/PICTURE mimes may be bare ("PNG", "JPG") — normalize to image/* */
  const type = !mime
    ? 'image/jpeg'
    : /^image\//i.test(mime)
      ? mime
      : `image/${mime.toLowerCase().replace(/^x-/, '')}`
  return new Promise((res) => {
    const fr = new FileReader()
    fr.onload = () => res(fr.result as string)
    fr.onerror = () => res('')
    fr.readAsDataURL(new Blob([bytes as BlobPart], { type }))
  })
}

/* ---- ID3v2.3 / v2.4 (mp3) ---- */
async function readId3(file: File): Promise<Tags> {
  const head = await readBytes(file, 0, 10)
  if (String.fromCharCode(head[0], head[1], head[2]) !== 'ID3') return {}
  const version = head[3]
  const size =
    ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f)
  const body = await readBytes(file, 10, 10 + size)
  const tags: Tags = {}
  let pos = 0

  if (head[5] & 0x40) {
    /* extended header */
    const eh =
      version === 4
        ? ((body[0] & 0x7f) << 21) | ((body[1] & 0x7f) << 14) | ((body[2] & 0x7f) << 7) | (body[3] & 0x7f)
        : (((body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3]) >>> 0)
    pos += version === 4 ? eh : eh + 4
  }

  while (pos + 10 <= body.length) {
    if (body[pos] === 0) break
    const id = String.fromCharCode(body[pos], body[pos + 1], body[pos + 2], body[pos + 3])
    const fsize =
      version === 4
        ? ((body[pos + 4] & 0x7f) << 21) | ((body[pos + 5] & 0x7f) << 14) | ((body[pos + 6] & 0x7f) << 7) | (body[pos + 7] & 0x7f)
        : (((body[pos + 4] << 24) | (body[pos + 5] << 16) | (body[pos + 6] << 8) | body[pos + 7]) >>> 0)
    if (fsize <= 0 || pos + 10 + fsize > body.length) break
    const data = body.subarray(pos + 10, pos + 10 + fsize)

    if ((id === 'TIT2' || id === 'TPE1') && data.length > 1) {
      const text = decodeText(data.subarray(1), data[0])
      if (text) {
        if (id === 'TIT2') tags.title = text
        else tags.artist = text
      }
    } else if (id === 'APIC' && !tags.cover && data.length > 4) {
      const enc = data[0]
      let i = 1
      while (i < data.length && data[i] !== 0) i++
      const mime = new TextDecoder('latin1').decode(data.subarray(1, i))
      i += 1 /* mime null */ + 1 /* picture type */
      if (enc === 1 || enc === 2) {
        while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2
        i += 2
      } else {
        while (i < data.length && data[i] !== 0) i++
        i += 1
      }
      const img = data.subarray(i)
      if (img.length > 10) tags.cover = await bytesToDataUrl(img, mime)
    }
    pos += 10 + fsize
    if (tags.title && tags.artist && tags.cover) break
  }
  return tags
}

/* ---- FLAC vorbis comments + embedded picture ---- */
async function readFlac(file: File): Promise<Tags> {
  const tags: Tags = {}
  let pos = 4
  for (let guard = 0; guard < 16; guard++) {
    const head = await readBytes(file, pos, pos + 4)
    const last = (head[0] & 0x80) !== 0
    const type = head[0] & 0x7f
    const len = (head[1] << 16) | (head[2] << 8) | head[3]
    const body = await readBytes(file, pos + 4, pos + 4 + len)

    if (type === 4 && body.length > 8) {
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength)
      let p = 0
      p += 4 + dv.getUint32(p, true) /* vendor */
      const count = dv.getUint32(p, true)
      p += 4
      for (let c = 0; c < count && p + 4 <= body.length; c++) {
        const clen = dv.getUint32(p, true)
        p += 4
        const kv = new TextDecoder('utf-8').decode(body.subarray(p, p + clen))
        p += clen
        const eq = kv.indexOf('=')
        if (eq > 0) {
          const key = kv.slice(0, eq).toUpperCase()
          const val = kv.slice(eq + 1)
          if (key === 'TITLE') tags.title = val
          else if (key === 'ARTIST') tags.artist = val
        }
      }
    } else if (type === 6 && !tags.cover && body.length > 32) {
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength)
      let p = 4 /* picture type */
      const mlen = dv.getUint32(p)
      p += 4
      const mime = new TextDecoder('latin1').decode(body.subarray(p, p + mlen))
      p += mlen
      const dlen = dv.getUint32(p)
      p += 4 + dlen
      p += 16 /* width, height, depth, colors */
      const ilen = dv.getUint32(p)
      p += 4
      tags.cover = await bytesToDataUrl(body.subarray(p, p + ilen), mime)
    }

    pos += 4 + len
    if (last) break
  }
  return tags
}

export async function readTags(file: File): Promise<Tags> {
  try {
    const head = await readBytes(file, 0, 4)
    const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
    if (magic.startsWith('ID3')) return await readId3(file)
    if (magic === 'fLaC') return await readFlac(file)
    return {}
  } catch {
    return {}
  }
}
