import { Transform, type TransformCallback } from 'node:stream';

/**
 * Bricht ab, sobald mehr Bytes durchlaufen, als angekündigt wurden.
 *
 * Nötig, weil `Content-Length` bei `Transfer-Encoding: chunked` fehlt: ohne
 * diese Bremse könnte ein Client beliebig viel auf die Platte schreiben,
 * obwohl er beim Anlegen eine kleine Dateigröße genannt hat.
 */
export class ByteLimitExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Der Upload überschreitet die angekündigte Größe von ${limit} Byte.`);
    this.name = 'ByteLimitExceededError';
  }
}

export class LimitStream extends Transform {
  private written = 0;

  constructor(private readonly limit: number) {
    super();
  }

  get bytesWritten(): number {
    return this.written;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.written + chunk.length > this.limit) {
      const allowed = this.limit - this.written;
      if (allowed > 0) {
        this.written += allowed;
        this.push(chunk.subarray(0, allowed));
      }
      callback(new ByteLimitExceededError(this.limit));
      return;
    }
    this.written += chunk.length;
    callback(null, chunk);
  }
}
