import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import { ByteLimitExceededError, LimitStream } from './limit-stream';

async function collect(source: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const limiter = new LimitStream(limit);
  await pipeline(source, limiter, async function* (stream) {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
      yield chunk;
    }
  });
  return Buffer.concat(chunks);
}

describe('LimitStream', () => {
  it('lässt Daten innerhalb des Limits unverändert durch', async () => {
    const result = await collect(Readable.from([Buffer.from('abc'), Buffer.from('def')]), 10);
    expect(result.toString()).toBe('abcdef');
  });

  it('lässt genau das Limit noch durch', async () => {
    const result = await collect(Readable.from([Buffer.from('abcdef')]), 6);
    expect(result.toString()).toBe('abcdef');
  });

  it('bricht ab, sobald mehr als angekündigt kommt', async () => {
    await expect(collect(Readable.from([Buffer.from('abcdefgh')]), 6)).rejects.toBeInstanceOf(
      ByteLimitExceededError,
    );
  });

  it('zählt die tatsächlich durchgelassenen Bytes', async () => {
    const limiter = new LimitStream(4);
    await expect(
      pipeline(Readable.from([Buffer.from('ab'), Buffer.from('cdef')]), limiter, async (stream) => {
        for await (const _chunk of stream) {
          // verwerfen, uns interessiert nur der Zähler
        }
      }),
    ).rejects.toBeInstanceOf(ByteLimitExceededError);
    expect(limiter.bytesWritten).toBe(4);
  });
});
