/**
 * A minimal RFC 6455 frame codec (#27).
 *
 * MSMS ships no WebSocket dependency. The live surface needs one direction of
 * real traffic — small JSON messages pushed to a subscriber — plus enough of the
 * receive path to read a subscribe request, answer a ping, and honour a close.
 * That is a few hundred lines of well-specified bit twiddling, and taking a
 * dependency for it would pull a native-adjacent package into a portable build
 * for a protocol whose entire framing fits on one page.
 *
 * Everything here is pure and operates on `Uint8Array`, not `Buffer`: this file
 * is under `shared/`, which the renderer bundle also compiles, and nothing in
 * `shared/` may reach for a Node builtin. It is also what makes the parser
 * testable without a socket — the interesting failures (a frame split across
 * two reads, two frames in one read, an unmasked client frame) are exactly the
 * ones a live smoke over loopback never produces.
 */

/** The magic value from RFC 6455 §4.2.2, concatenated before the SHA-1. */
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/**
 * Largest client message accepted, in bytes.
 *
 * A subscribe request is a few hundred bytes. Anything approaching this is
 * either a bug or an attempt to make the server hold memory on the strength of
 * a length field, so it is refused with 1009 rather than allocated. It also
 * means the 64-bit length path is never taken for a legitimate message.
 */
export const WS_MAX_PAYLOAD = 64 * 1024

export const WS_OP = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa
} as const

/** Close codes this codec produces. 1000 is the caller's to send. */
export const WS_CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  invalidPayload: 1007,
  policyViolation: 1008,
  tooBig: 1009,
  internalError: 1011,
  /** Overloaded — the client is not reading fast enough. */
  tryAgainLater: 1013
} as const

export type WsEvent =
  | { type: 'text'; text: string }
  | { type: 'binary'; data: Uint8Array }
  | { type: 'ping'; data: Uint8Array }
  | { type: 'pong'; data: Uint8Array }
  | { type: 'close'; code: number; reason: string }
  /** A protocol violation. The caller must close with `code` and stop reading. */
  | { type: 'fail'; code: number; reason: string }

/** Slices one message may arrive in. Generous; nothing legitimate fragments. */
const MAX_FRAGMENTS = 512

const EMPTY = new Uint8Array(0)

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b
  if (!b.length) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * Encode a frame to send. Server-to-client frames are never masked (RFC 6455
 * §5.1) — masking exists to stop a client script poisoning a transparent proxy,
 * which does not apply in this direction, and a masked server frame is a
 * protocol error the client must close on.
 */
export function encodeFrame(opcode: number, payload: Uint8Array = EMPTY): Uint8Array {
  const len = payload.length
  const header = len < 126 ? 2 : len < 65536 ? 4 : 10
  const out = new Uint8Array(header + len)
  out[0] = 0x80 | (opcode & 0x0f) // FIN set: nothing here fragments
  if (len < 126) {
    out[1] = len
  } else if (len < 65536) {
    out[1] = 126
    out[2] = (len >> 8) & 0xff
    out[3] = len & 0xff
  } else {
    out[1] = 127
    // The high four bytes stay zero: a payload over 4 GiB is not something this
    // process can hold, let alone want to.
    out[6] = (len >>> 24) & 0xff
    out[7] = (len >>> 16) & 0xff
    out[8] = (len >>> 8) & 0xff
    out[9] = len & 0xff
  }
  out.set(payload, header)
  return out
}

const encoder = new TextEncoder()

export function encodeText(text: string): Uint8Array {
  return encodeFrame(WS_OP.text, encoder.encode(text))
}

export function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value))
}

export function encodePong(payload: Uint8Array = EMPTY): Uint8Array {
  return encodeFrame(WS_OP.pong, payload)
}

export function encodePing(payload: Uint8Array = EMPTY): Uint8Array {
  return encodeFrame(WS_OP.ping, payload)
}

export function encodeClose(code: number, reason = ''): Uint8Array {
  const body = encoder.encode(reason)
  // A close body is a control payload: 125 bytes total, two of them the code.
  const trimmed = body.length > 123 ? body.subarray(0, 123) : body
  const payload = new Uint8Array(2 + trimmed.length)
  payload[0] = (code >> 8) & 0xff
  payload[1] = code & 0xff
  payload.set(trimmed, 2)
  return encodeFrame(WS_OP.close, payload)
}

/** Mask (or unmask — the operation is its own inverse) a payload in place. */
export function maskPayload(payload: Uint8Array, key: Uint8Array): Uint8Array {
  for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3]
  return payload
}

/**
 * Build a client-to-server frame. Not used by the server itself — it exists so
 * the smoke can drive the parser with real masked frames, including ones split
 * at awkward offsets, without opening a socket.
 */
export function encodeClientFrame(
  opcode: number,
  payload: Uint8Array = EMPTY,
  key = new Uint8Array([0x12, 0x34, 0x56, 0x78]),
  fin = true
): Uint8Array {
  const len = payload.length
  const extra = len < 126 ? 0 : len < 65536 ? 2 : 8
  const out = new Uint8Array(2 + extra + 4 + len)
  out[0] = (fin ? 0x80 : 0) | (opcode & 0x0f)
  out[1] = 0x80 | (len < 126 ? len : len < 65536 ? 126 : 127)
  if (extra === 2) {
    out[2] = (len >> 8) & 0xff
    out[3] = len & 0xff
  } else if (extra === 8) {
    out[6] = (len >>> 24) & 0xff
    out[7] = (len >>> 16) & 0xff
    out[8] = (len >>> 8) & 0xff
    out[9] = len & 0xff
  }
  out.set(key, 2 + extra)
  const body = payload.slice()
  maskPayload(body, key)
  out.set(body, 2 + extra + 4)
  return out
}

/**
 * Incremental frame parser for the receive side.
 *
 * Stateful on purpose. TCP delivers a stream, not frames: one read can carry
 * three frames and half of a fourth, and the next can carry the rest of it.
 * A `decode(chunk)` helper passes a test that writes one small frame and then
 * corrupts the first real conversation it meets — the same lesson the console
 * decoder learned in #83, in binary.
 */
export class WsParser {
  private buf: Uint8Array = EMPTY
  private fragments: Uint8Array[] = []
  private fragOpcode = 0
  private fragBytes = 0
  private dead = false
  /**
   * Whether incoming frames must be masked.
   *
   * The rule is not a property of the parser, it is a property of the direction:
   * RFC 6455 §5.1 requires client-to-server frames to be masked and forbids it
   * server-to-client. The server reads the first (the default), and a client
   * reading a server reads the second. Hard-coding "always masked" made a parser
   * that could not read the very frames this file encodes.
   */
  private readonly requireMask: boolean

  constructor(opts: { requireMask?: boolean } = {}) {
    this.requireMask = opts.requireMask !== false
  }

  /** Bytes buffered but not yet a complete frame. Diagnostics only. */
  get pending(): number {
    return this.buf.length
  }

  /**
   * Feed bytes, get whatever completed. A `fail` event is terminal: the parser
   * stops after it, so a caller that keeps pumping bytes at a broken connection
   * gets nothing more rather than a second opinion.
   */
  push(chunk: Uint8Array): WsEvent[] {
    const out: WsEvent[] = []
    if (this.dead) return out
    this.buf = concat(this.buf, chunk)
    for (;;) {
      const ev = this.next()
      // `null` is "need more bytes"; `undefined` is "a frame was consumed but it
      // was a fragment, so there is nothing to hand over yet". Distinguishing
      // them is what keeps this a loop instead of a recursion — a client can put
      // ten thousand empty continuation frames in one 64 KB read, and recursing
      // once per frame would blow the stack on a message that never exceeds the
      // size cap.
      if (ev === null) break
      if (ev === undefined) continue
      out.push(ev)
      if (ev.type === 'fail') {
        this.dead = true
        this.buf = EMPTY
        break
      }
    }
    return out
  }

  private fail(code: number, reason: string): WsEvent {
    return { type: 'fail', code, reason }
  }

  /** `null` = need more bytes, `undefined` = frame consumed, nothing to emit. */
  private next(): WsEvent | null | undefined {
    const b = this.buf
    if (b.length < 2) return null
    const first = b[0]
    const second = b[1]
    // RSV1-3 are extension bits. No extension was negotiated, so a frame using
    // one is a frame this parser cannot claim to understand.
    if (first & 0x70) return this.fail(WS_CLOSE.protocolError, 'rsv-bit-set')
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let len = second & 0x7f
    let offset = 2

    if (len === 126) {
      if (b.length < 4) return null
      len = (b[2] << 8) | b[3]
      offset = 4
    } else if (len === 127) {
      if (b.length < 10) return null
      // The top four bytes of a 64-bit length can only describe a payload this
      // process would never accept, so their being non-zero is decided here
      // rather than after a 4 GiB allocation.
      if (b[2] || b[3] || b[4] || b[5]) return this.fail(WS_CLOSE.tooBig, 'payload-too-large')
      len = b[6] * 0x1000000 + (b[7] << 16) + (b[8] << 8) + b[9]
      offset = 10
    }
    if (len > WS_MAX_PAYLOAD) return this.fail(WS_CLOSE.tooBig, 'payload-too-large')

    const isControl = (opcode & 0x8) !== 0
    if (isControl) {
      // Control frames carry status, not data: they are never fragmented and
      // never longer than 125 bytes.
      if (!fin) return this.fail(WS_CLOSE.protocolError, 'fragmented-control-frame')
      if (len > 125) return this.fail(WS_CLOSE.protocolError, 'control-frame-too-long')
    }
    // Every frame from a client is masked. An unmasked one is either a broken
    // client or something that is not a client at all.
    if (this.requireMask && !masked) return this.fail(WS_CLOSE.protocolError, 'unmasked-client-frame')
    // ...and a server must never mask. Reading one as if it had is how a
    // correct frame turns into gibberish.
    if (!this.requireMask && masked) return this.fail(WS_CLOSE.protocolError, 'masked-server-frame')

    const total = offset + (masked ? 4 : 0) + len
    if (b.length < total) return null
    const payload = b.slice(offset + (masked ? 4 : 0), total)
    if (masked) maskPayload(payload, b.subarray(offset, offset + 4))
    this.buf = b.subarray(total)

    if (isControl) {
      if (opcode === WS_OP.ping) return { type: 'ping', data: payload }
      if (opcode === WS_OP.pong) return { type: 'pong', data: payload }
      if (opcode === WS_OP.close) {
        const code = payload.length >= 2 ? (payload[0] << 8) | payload[1] : WS_CLOSE.normal
        return { type: 'close', code, reason: decodeUtf8(payload.subarray(2)) ?? '' }
      }
      return this.fail(WS_CLOSE.protocolError, 'unknown-control-opcode')
    }

    if (opcode === WS_OP.continuation) {
      if (!this.fragments.length) return this.fail(WS_CLOSE.protocolError, 'orphan-continuation')
    } else if (opcode === WS_OP.text || opcode === WS_OP.binary) {
      if (this.fragments.length) return this.fail(WS_CLOSE.protocolError, 'interleaved-data-frame')
      this.fragOpcode = opcode
    } else {
      return this.fail(WS_CLOSE.protocolError, 'unknown-opcode')
    }

    this.fragBytes += payload.length
    // The cap is on the assembled message, not the frame: fragmenting is not a
    // way to hand over more than the limit one slice at a time.
    if (this.fragBytes > WS_MAX_PAYLOAD) return this.fail(WS_CLOSE.tooBig, 'payload-too-large')
    this.fragments.push(payload)
    // Empty fragments cost no bytes, so the size cap alone never stops a client
    // that sends nothing but zero-length continuations. This does.
    if (this.fragments.length > MAX_FRAGMENTS) {
      return this.fail(WS_CLOSE.tooBig, 'too-many-fragments')
    }
    if (!fin) return undefined

    const whole = this.fragments.length === 1 ? this.fragments[0] : joinAll(this.fragments, this.fragBytes)
    const wasText = this.fragOpcode === WS_OP.text
    this.fragments = []
    this.fragBytes = 0
    if (!wasText) return { type: 'binary', data: whole }
    const text = decodeUtf8(whole)
    // RFC 6455 §8.1: a text frame that is not valid UTF-8 is 1007, not a
    // best-effort string full of replacement characters.
    if (text === null) return this.fail(WS_CLOSE.invalidPayload, 'invalid-utf8')
    return { type: 'text', text }
  }
}

function joinAll(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true })

/** Strict UTF-8 decode; null when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  if (!bytes.length) return ''
  try {
    return strictDecoder.decode(bytes)
  } catch {
    return null
  }
}
