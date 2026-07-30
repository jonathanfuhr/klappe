/**
 * Liegt der Index einer MP4/MOV-Datei vorn?
 *
 * Steht `moov` hinter `mdat`, muss ein Browser erst die ganze Datei laden,
 * bevor er springen kann – bei 4K-Material sind das schnell Gigabyte. Genau
 * das verhindert `-movflags +faststart`.
 *
 * Für die Frage reicht es, die Kette der obersten Boxen abzulaufen: Jede Box
 * beginnt mit ihrer Größe und ihrem Typ, danach folgt die nächste. Wir lesen
 * also nur eine Handvoll Kopfzeilen und nicht die Datei selbst.
 */

/** Liest `length` Bytes ab `offset`; darf weniger liefern (Dateiende). */
export type ByteReader = (offset: number, length: number) => Promise<Buffer>;

export type BoxOrder = {
  types: string[];
  /** `true`, wenn `moov` vor `mdat` steht. */
  fastStart: boolean;
};

const HEADER_BYTES = 16;
/** Sicherheitsnetz gegen kaputte Dateien mit endlosen Mini-Boxen. */
const MAX_BOXES = 64;

export async function readTopLevelBoxes(read: ByteReader, fileSize: number): Promise<BoxOrder> {
  const types: string[] = [];
  let offset = 0;

  for (let index = 0; index < MAX_BOXES && offset < fileSize; index += 1) {
    const header = await read(offset, HEADER_BYTES);
    if (header.length < 8) break;

    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;

    let headerSize = 8;
    if (size === 1) {
      // 64-Bit-Größe steht direkt hinter dem Typ.
      if (header.length < 16) break;
      const large = header.readBigUInt64BE(8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      // Reicht bis zum Dateiende – danach kommt nichts mehr.
      types.push(type);
      break;
    }

    if (size < headerSize) break;
    types.push(type);
    offset += size;
  }

  const moov = types.indexOf('moov');
  const mdat = types.indexOf('mdat');
  return {
    types,
    // Ohne `mdat` (oder ohne beides) ist die Frage gegenstandslos – dann gilt
    // die Datei als in Ordnung, sofern der Index überhaupt gefunden wurde.
    fastStart: moov !== -1 && (mdat === -1 || moov < mdat),
  };
}
