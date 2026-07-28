import { describe, expect, it } from 'vitest';
import { type ByteReader, readTopLevelBoxes } from './mp4-faststart';

/** Baut eine Folge oberster Boxen als Puffer – nur Kopfzeilen zählen. */
function buildFile(boxes: Array<{ type: string; payload?: number; large?: boolean }>): Buffer {
  const parts = boxes.map((box) => {
    const payload = box.payload ?? 32;
    if (box.large) {
      const header = Buffer.alloc(16);
      header.writeUInt32BE(1, 0);
      header.write(box.type, 4, 'latin1');
      header.writeBigUInt64BE(BigInt(16 + payload), 8);
      return Buffer.concat([header, Buffer.alloc(payload)]);
    }
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload, 0);
    header.write(box.type, 4, 'latin1');
    return Buffer.concat([header, Buffer.alloc(payload)]);
  });
  return Buffer.concat(parts);
}

function readerFor(buffer: Buffer): { read: ByteReader; size: number; calls: () => number } {
  let calls = 0;
  return {
    size: buffer.length,
    calls: () => calls,
    read: async (offset, length) => {
      calls += 1;
      return buffer.subarray(offset, Math.min(offset + length, buffer.length));
    },
  };
}

describe('readTopLevelBoxes', () => {
  it('erkennt eine Datei mit Index vorn', async () => {
    const file = readerFor(
      buildFile([{ type: 'ftyp', payload: 24 }, { type: 'moov', payload: 500 }, { type: 'mdat', payload: 4000 }]),
    );
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result.types).toEqual(['ftyp', 'moov', 'mdat']);
    expect(result.fastStart).toBe(true);
  });

  it('erkennt eine Datei mit Index hinten', async () => {
    const file = readerFor(
      buildFile([{ type: 'ftyp', payload: 24 }, { type: 'mdat', payload: 4000 }, { type: 'moov', payload: 500 }]),
    );
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result.fastStart).toBe(false);
  });

  it('liest nur Kopfzeilen und nicht die Nutzdaten', async () => {
    const file = readerFor(
      buildFile([{ type: 'ftyp' }, { type: 'moov' }, { type: 'mdat', payload: 5_000_000 }]),
    );
    await readTopLevelBoxes(file.read, file.size);
    // Drei Boxen – also höchstens eine Handvoll Lesezugriffe.
    expect(file.calls()).toBeLessThanOrEqual(4);
  });

  it('versteht 64-Bit-Größen', async () => {
    const file = readerFor(
      buildFile([{ type: 'ftyp' }, { type: 'mdat', payload: 200, large: true }, { type: 'moov' }]),
    );
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result.types).toEqual(['ftyp', 'mdat', 'moov']);
    expect(result.fastStart).toBe(false);
  });

  it('behandelt eine Box mit Größe 0 als letzte', async () => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0, 0);
    header.write('mdat', 4, 'latin1');
    const file = readerFor(
      Buffer.concat([buildFile([{ type: 'ftyp' }, { type: 'moov' }]), header, Buffer.alloc(999)]),
    );
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result.types).toEqual(['ftyp', 'moov', 'mdat']);
    expect(result.fastStart).toBe(true);
  });

  it('bricht bei unsinnigen Daten ab, statt sich zu verhaken', async () => {
    const file = readerFor(Buffer.from('das ist kein mp4, sondern nur text'));
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result.fastStart).toBe(false);
  });

  it('kommt mit einer leeren Datei klar', async () => {
    const file = readerFor(Buffer.alloc(0));
    const result = await readTopLevelBoxes(file.read, file.size);
    expect(result).toEqual({ types: [], fastStart: false });
  });

  it('gilt ohne mdat als in Ordnung, sofern der Index da ist', async () => {
    const file = readerFor(buildFile([{ type: 'ftyp' }, { type: 'moov' }]));
    expect((await readTopLevelBoxes(file.read, file.size)).fastStart).toBe(true);
  });
});
