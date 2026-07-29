/**
 * Shared UTF-8 incomplete-tail helpers for ConPTY/chunked PTY streams.
 */

/** Bytes at the end of `buf` that form an incomplete UTF-8 character (0-3). */
export function incompleteUtf8Tail(buf: Buffer): number {
  const n = buf.length
  if (n === 0) return 0
  let i = n - 1
  let cont = 0
  while (i >= 0 && cont < 3 && (buf[i]! & 0xc0) === 0x80) {
    cont++
    i--
  }
  if (i < 0) return 0
  const lead = buf[i]!
  if ((lead & 0x80) === 0) return 0
  let need = 0
  if ((lead & 0xe0) === 0xc0) need = 2
  else if ((lead & 0xf0) === 0xe0) need = 3
  else if ((lead & 0xf8) === 0xf0) need = 4
  else return 0
  const have = n - i
  return have < need ? have : 0
}

/**
 * Decode a base64 PTY chunk to UTF-8, holding incomplete multi-byte tails.
 */
export function decodeUtf8Chunk(
  carry: Map<string, Buffer>,
  id: string,
  dataB64: string
): string {
  const chunk = Buffer.from(dataB64, 'base64')
  if (!chunk.length) return ''
  const prev = carry.get(id)
  const buf = prev && prev.length ? Buffer.concat([prev, chunk]) : chunk
  const keep = incompleteUtf8Tail(buf)
  const emitEnd = buf.length - keep
  if (keep > 0) carry.set(id, Buffer.from(buf.subarray(emitEnd)))
  else carry.delete(id)
  if (emitEnd <= 0) return ''
  return buf.subarray(0, emitEnd).toString('utf8')
}
