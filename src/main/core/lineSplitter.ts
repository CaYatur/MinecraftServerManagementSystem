import { StringDecoder } from 'node:string_decoder'

/**
 * Turns a byte stream into whole lines.
 *
 * Split out of the process manager so it can be exercised without spawning a
 * Minecraft server: the only interesting thing it does is survive a chunk
 * boundary landing in the wrong place, and that is impossible to provoke
 * reliably through a real pipe.
 *
 * Two boundaries can cut a chunk in half and both have to be held over:
 *
 * - **A line boundary.** Obvious, and the old code already handled it with a
 *   string buffer.
 * - **A character boundary.** A pipe hands over bytes, not characters, so a
 *   chunk can end part-way through a multi-byte UTF-8 sequence.
 *   `Buffer.toString('utf-8')` on a truncated sequence emits U+FFFD and then
 *   mis-decodes the continuation bytes at the head of the next chunk, so one
 *   split character corrupts two of them. Every Turkish letter outside ASCII is
 *   two bytes, a section sign (colour codes) is two, an emoji is four - which is
 *   why the damage looked intermittent rather than constant. `StringDecoder`
 *   holds the incomplete tail back until the bytes that finish it arrive.
 *
 * One splitter per stream. stdout and stderr are independent byte streams, and
 * a shared decoder would splice one's partial character onto the other's next
 * chunk and corrupt both.
 */
export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8')
  private buf = ''

  /** Feed a chunk; get back the complete lines it finished, `\r` trimmed. */
  push(chunk: Buffer): string[] {
    this.buf += this.decoder.write(chunk)
    const out: string[] = []
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      out.push(this.buf.slice(0, idx).replace(/\r$/, ''))
      this.buf = this.buf.slice(idx + 1)
    }
    return out
  }

  /**
   * Whatever is still buffered, without waiting for a newline.
   *
   * A server that dies mid-line, or one whose last line has no trailing
   * newline, would otherwise take its final words - often the reason it died -
   * to the grave. `decoder.end()` also flushes any bytes it was holding, which
   * become U+FFFD here: those bytes are genuinely unfinished and no later chunk
   * is coming.
   */
  flush(): string {
    const rest = this.buf + this.decoder.end()
    this.buf = ''
    return rest.replace(/\r$/, '')
  }

  /** Is anything held back? */
  get pending(): boolean {
    return this.buf.length > 0
  }
}
