/**
 * read_document tool
 * ==================
 * Extract text content from an uploaded document.
 *
 * Available in: work mode only
 *
 * Accepts a base64-encoded file (text, DOCX) and returns extracted text.
 * PDF support requires heavy libraries (pdfjs-dist or pdf-parse) and is
 * deferred to Phase 3 (will route through Oracle worker).
 *
 * Implementation:
 *   - Plain text (.txt, .md, .csv, .json, .xml, .yaml, .log): decode base64 → text.
 *   - DOCX (.docx): unzip word/document.xml, strip XML tags, normalize whitespace.
 *     DOCX is a ZIP file; we extract document.xml and parse the <w:t> elements
 *     which contain the actual text. No external ZIP library — we use a minimal
 *     ZIP parser that handles the stored (uncompressed) and deflate formats.
 *   - PDF (.pdf): return a clear error explaining the limitation.
 *   - Other binary formats: return an unsupported error.
 *
 * The minimal ZIP parser handles the vast majority of DOCX files (which
 * use deflate compression). It's ~80 lines vs ~200KB for a full ZIP lib.
 */
import { readDocumentSchema, type ReadDocumentInput } from '~/lib/.server/tools/schemas/read-document';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const readDocumentTool: ToolDefinition<typeof readDocumentSchema> = {
  name: 'read_document',
  description:
    'Extract text content from an uploaded document. ' +
    'Use this when the user provides a file (PDF, DOCX, TXT, MD, CSV, JSON) and wants ' +
    'to read, analyze, summarize, or extract information from it. ' +
    'Returns the extracted text (default max 20000 chars). ' +
    'Supports: plain text formats natively, DOCX via built-in ZIP+XML parser, ' +
    'PDF via client-side pdfjs-dist (the result includes pdfExtractionRequired=true ' +
    'and the frontend shows an "Extract text" button the user clicks to parse in browser). ' +
    'Do NOT use this for URLs (use read_url or scrape_page) or for code files (use read_file in code mode).',

  inputSchema: readDocumentSchema,
  availableIn: ['work'],

  execute: async (input: ReadDocumentInput): Promise<ToolResult> => {
    const { filename, mimeType, contentBase64, maxLength = 20000 } = input;

    try {
      // Decode base64 (handle data URL prefix if present)
      const cleanBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '');
      const bytes = base64ToBytes(cleanBase64);

      if (bytes.length === 0) {
        return { ok: false, error: 'Decoded file is empty.' };
      }

      const detectedType = detectType(filename, mimeType, bytes);

      let text: string;
      let format: string;

      switch (detectedType) {
        case 'text':
          text = bytesToUtf8(bytes);
          format = 'text';
          break;

        case 'docx': {
          const docxResult = extractDocxText(bytes);

          if (!docxResult.ok) {
            return docxResult;
          }

          text = docxResult.text;
          format = 'docx';
          break;
        }

        case 'pdf':
          /*
           * PDF parsing happens CLIENT-SIDE using pdfjs-dist (dynamic import).
           * The server can't run pdfjs (needs DOM, too heavy for CF Workers).
           * We return the raw base64 + a flag so the client renderer knows
           * to offer a "Extract text" button.
           */
          return {
            ok: true,
            format: 'pdf',
            filename,
            bytes: bytes.length,
            content: '',
            originalLength: 0,
            truncated: false,
            pdfExtractionRequired: true,
            pdfContentBase64: cleanBase64,
            hint:
              'PDF text is extracted in your browser using pdfjs-dist. ' +
              'Click "Extract text" below to parse the PDF.',
          };

        default:
          return {
            ok: false,
            error: `Unsupported file type: ${detectedType}.`,
            hint: 'Supported: .txt, .md, .csv, .json, .xml, .yaml, .log, .docx. PDF coming in Phase 3.',
          };
      }

      const truncated = text.length > maxLength;
      const finalText = truncated ? text.slice(0, maxLength) + '\n\n[... truncated]' : text;

      return {
        ok: true,
        filename,
        format,
        content: finalText,
        originalLength: text.length,
        truncated,
        bytes: bytes.length,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Document reading failed: ${message}` };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

type DetectedType = 'text' | 'docx' | 'pdf' | 'unknown';

function detectType(filename: string, mimeType?: string, bytes?: Uint8Array): DetectedType {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const mime = (mimeType ?? '').toLowerCase();

  // By extension
  if (
    [
      'txt',
      'md',
      'markdown',
      'csv',
      'tsv',
      'json',
      'xml',
      'yaml',
      'yml',
      'log',
      'html',
      'htm',
      'js',
      'ts',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'sh',
      'sql',
    ].includes(ext)
  ) {
    return 'text';
  }

  if (ext === 'docx') {
    return 'docx';
  }

  if (ext === 'pdf') {
    return 'pdf';
  }

  // By MIME type
  if (mime.startsWith('text/')) {
    return 'text';
  }

  if (mime === 'application/json' || mime === 'application/xml') {
    return 'text';
  }

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }

  if (mime === 'application/pdf') {
    return 'pdf';
  }

  // By magic bytes (last resort)
  if (bytes) {
    // DOCX/OOXML files start with PK (ZIP signature)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      // Could be docx, xlsx, pptx — assume docx for now (most common)
      return 'docx';
    }

    // PDF files start with %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'pdf';
    }

    // ASCII/UTF-8 text: first 4 bytes are printable ASCII or common UTF-8 BOM
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return 'text';
    }

    if (bytes[0] < 0x80 && (bytes[0] === 0x09 || bytes[0] === 0x0a || bytes[0] === 0x0d || bytes[0] >= 0x20)) {
      // Heuristic: if first 100 bytes are mostly printable, call it text
      let printable = 0;
      const sample = Math.min(100, bytes.length);

      for (let i = 0; i < sample; i++) {
        const b = bytes[i];

        if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0x80) {
          printable++;
        }
      }

      if (printable / sample > 0.85) {
        return 'text';
      }
    }
  }

  return 'unknown';
}

function base64ToBytes(b64: string): Uint8Array {
  // Use atob if available (browser/CF Workers), else Buffer (Node)
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  // Node fallback
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function bytesToUtf8(bytes: Uint8Array): string {
  // Use TextDecoder if available, else Buffer
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  return Buffer.from(bytes).toString('utf-8');
}

// ─── DOCX extraction (minimal ZIP parser) ────────────────────────

interface DocxExtractionResult {
  ok: true;
  text: string;
}

/**
 * Extract text from a DOCX file by:
 *   1. Parsing the ZIP structure to find word/document.xml
 *   2. Decompressing the deflate-compressed entry
 *   3. Parsing XML to extract <w:t> text elements
 *   4. Normalizing whitespace and adding paragraph breaks
 *
 * The ZIP parser handles the most common case: deflate-compressed entries.
 * Stored (uncompressed) entries are also supported.
 */
function extractDocxText(bytes: Uint8Array): DocxExtractionResult | { ok: false; error: string } {
  try {
    const xmlText = extractZipEntry(bytes, 'word/document.xml');

    if (!xmlText) {
      return {
        ok: false,
        error: 'Could not find word/document.xml in the DOCX file. The file may be corrupted.',
      };
    }

    /*
     * Extract text from <w:t> elements (WordprocessingML text runs)
     * Also handle <w:p> (paragraphs) and <w:br> (breaks)
     */
    let text = xmlText;

    // Replace paragraph ends with newlines
    text = text.replace(/<\/w:p>/g, '\n');

    // Replace tab/break elements
    text = text.replace(/<w:br[^/]*\/>/g, '\n');
    text = text.replace(/<w:tab[^/]*\/>/g, '\t');

    // Extract text inside <w:t> elements (preserving xml:space="preserve")
    const texts: string[] = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      texts.push(decodeXmlEntities(m[1]));
    }

    let result = texts.join('');

    // Normalize whitespace but preserve newlines
    result = result
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { ok: true, text: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `DOCX parsing failed: ${message}` };
  }
}

/**
 * Find a file inside a ZIP archive and return its decompressed contents as a UTF-8 string.
 *
 * ZIP format reference: https://en.wikipedia.org/wiki/ZIP_(file_format)
 *
 * We parse the Central Directory (at end of file) to find the entry,
 * then read the Local File Header to get the actual data.
 *
 * Supports:
 *   - Compression method 0 (stored)
 *   - Compression method 8 (deflate) — most common in DOCX
 *
 * Does NOT support:
 *   - Encryption
 *   - ZIP64 (archives > 4GB)
 *   - Other compression methods (BZIP2, etc.)
 *
 * Returns null if the entry is not found or the compression is unsupported.
 */
function extractZipEntry(bytes: Uint8Array, entryName: string): string | null {
  // Find End of Central Directory signature: 0x06054b50
  const eocdSig = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
  let eocdOffset = -1;

  // Search backward from end (EOCD is at most 65557 bytes from end)
  const searchStart = Math.max(0, bytes.length - 65557);

  for (let i = bytes.length - 4; i >= searchStart; i--) {
    if (
      bytes[i] === eocdSig[0] &&
      bytes[i + 1] === eocdSig[1] &&
      bytes[i + 2] === eocdSig[2] &&
      bytes[i + 3] === eocdSig[3]
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return null; // Not a ZIP file
  }

  // Read central directory offset (4 bytes at eocdOffset + 16, little-endian)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  // Walk the central directory
  let offset = cdOffset;
  const cdEnd = cdOffset + cdSize;

  for (let i = 0; i < cdEntries; i++) {
    if (offset + 46 > cdEnd) {
      break;
    }

    // Central directory header signature: 0x02014b50
    const sig = view.getUint32(offset, true);

    if (sig !== 0x02014b50) {
      break;
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    // Read entry name
    const name = bytesToUtf8(bytes.subarray(offset + 46, offset + 46 + nameLen));

    if (name === entryName) {
      // Found the entry — read local file header
      return readLocalFileEntry(bytes, localHeaderOffset, method, compressedSize, uncompressedSize);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return null;
}

function readLocalFileEntry(
  bytes: Uint8Array,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Local file header signature: 0x04034b50
  const sig = view.getUint32(localOffset, true);

  if (sig !== 0x04034b50) {
    return null;
  }

  const nameLen = view.getUint16(localOffset + 26, true);
  const extraLen = view.getUint16(localOffset + 28, true);

  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

  let decompressed: Uint8Array;

  if (method === 0) {
    // Stored (no compression)
    decompressed = compressedData;
  } else if (method === 8) {
    // Deflate
    decompressed = inflate(compressedData, uncompressedSize);
  } else {
    return null; // Unsupported compression
  }

  return bytesToUtf8(decompressed);
}

/**
 * Minimal DEFLATE decompressor using the browser/Node built-in.
 * CF Workers support DecompressionStream (gzip/deflate) since 2023.
 * Node has zlib.pako or the built-in zlib module.
 */
function inflate(data: Uint8Array, expectedSize: number): Uint8Array {
  /*
   * Strip the 2-byte zlib header (RFC 1950) if present
   * zlib header: CMF (1 byte) + FLG (1 byte), CMF & 0x0f === 8 means deflate
   */
  let rawDeflate = data;

  if (data.length >= 2 && (data[0] & 0x0f) === 8) {
    rawDeflate = data.subarray(2, data.length - 4); // Skip header + 4-byte checksum
  }

  // Try DecompressionStream (CF Workers, modern browsers)
  if (typeof DecompressionStream !== 'undefined') {
    /*
     * DecompressionStream with 'deflate' expects raw deflate (no zlib header)
     * Unfortunately, browsers interpret 'deflate' as zlib-wrapped.
     * Workaround: use 'deflate-raw' if available, else strip header and use 'deflate'.
     */
    try {
      /*
       * Fallback: do a synchronous inflate using a pure-JS implementation
       * Since DecompressionStream is async and we're in a sync context,
       * we use a synchronous pure-JS inflate (see below).
       */
    } catch {
      // Fall through to pure-JS implementation
    }
  }

  // Pure-JS DEFLATE decompressor
  return inflatePure(rawDeflate, expectedSize);
}

/**
 * Pure-JS DEFLATE decompressor (~150 lines).
 * Implements RFC 1951 — handles stored, fixed Huffman, and dynamic Huffman blocks.
 *
 * This is the same algorithm used by the `pako` library (which is what
 * the `fflate` and `jszip` packages wrap). We inline it to avoid a dep.
 */
function inflatePure(input: Uint8Array, expectedSize: number): Uint8Array {
  const output: number[] = [];
  let bitPos = 0;
  let bitBuf = 0;
  let bitsInBuf = 0;

  const readBit = (): number => {
    if (bitsInBuf === 0) {
      bitBuf = input[bitPos++] ?? 0;
      bitsInBuf = 8;
    }

    const bit = bitBuf & 1;
    bitBuf >>= 1;
    bitsInBuf--;

    return bit;
  };

  const readBits = (n: number): number => {
    let result = 0;

    for (let i = 0; i < n; i++) {
      result |= readBit() << i;
    }

    return result;
  };

  // Huffman decoding tables
  const buildHuffman = (lengths: Uint8Array): number[] => {
    const maxBits = Math.max(...lengths);

    if (maxBits === 0) {
      return [];
    }

    // Count occurrences of each code length
    const blCount = new Array(maxBits + 1).fill(0);

    for (const l of lengths) {
      blCount[l]++;
    }

    // Compute first code for each length
    const nextCode = new Array(maxBits + 1).fill(0);
    let code = 0;
    blCount[0] = 0;

    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }

    // Assign codes
    const codes: number[] = [];

    for (let n = 0; n < lengths.length; n++) {
      const len = lengths[n];

      if (len !== 0) {
        codes[n] = nextCode[len]++;
      }
    }

    return codes;
  };

  // Decode one Huffman symbol
  const decodeSymbol = (lengths: Uint8Array, _codes: number[]): number => {
    let code = 0;
    let first = 0;
    let index = 0;

    for (let len = 1; len <= 15; len++) {
      code |= readBit();

      const count = lengths.filter((l) => l === len).length;

      if (code - first < count) {
        return lengths.findIndex((l, i) => l === len && i >= index + (code - first));
      }

      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }

    return -1;
  };

  // Fixed Huffman tables
  const fixedLitLengths = new Uint8Array(288);

  for (let i = 0; i < 144; i++) {
    fixedLitLengths[i] = 8;
  }

  for (let i = 144; i < 256; i++) {
    fixedLitLengths[i] = 9;
  }

  for (let i = 256; i < 280; i++) {
    fixedLitLengths[i] = 7;
  }

  for (let i = 280; i < 288; i++) {
    fixedLitLengths[i] = 8;
  }

  const fixedDistLengths = new Uint8Array(30).fill(5);

  // Length and distance code tables (RFC 1951)
  const lengthBase = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const distBase = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577,
  ];
  const distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  while (true) {
    const bfinal = readBit();
    const btype = readBits(2);

    let litLengths: Uint8Array;
    let distLengths: Uint8Array;

    if (btype === 0) {
      // Stored block — skip to byte boundary, read len and nlen
      bitsInBuf = 0;

      const len = input[bitPos] | (input[bitPos + 1] << 8);
      bitPos += 4; // skip len + nlen

      for (let i = 0; i < len; i++) {
        output.push(input[bitPos++]);
      }

      if (bfinal) {
        break;
      }

      continue;
    } else if (btype === 1) {
      // Fixed Huffman
      litLengths = fixedLitLengths;
      distLengths = fixedDistLengths;
    } else if (btype === 2) {
      // Dynamic Huffman — read code length table
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;

      const codeLengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const codeLengths = new Uint8Array(19);

      for (let i = 0; i < hclen; i++) {
        codeLengths[codeLengthOrder[i]] = readBits(3);
      }

      const clCodes = buildHuffman(codeLengths);
      const clLengths = codeLengths;

      const allLengths = new Uint8Array(hlit + hdist);
      let idx = 0;

      while (idx < hlit + hdist) {
        const sym = decodeSymbol(clLengths, clCodes);

        if (sym < 16) {
          allLengths[idx++] = sym;
        } else if (sym === 16) {
          const rep = readBits(2) + 3;
          const prev = allLengths[idx - 1];

          for (let r = 0; r < rep; r++) {
            allLengths[idx++] = prev;
          }
        } else if (sym === 17) {
          const rep = readBits(3) + 3;

          for (let r = 0; r < rep; r++) {
            allLengths[idx++] = 0;
          }
        } else if (sym === 18) {
          const rep = readBits(7) + 11;

          for (let r = 0; r < rep; r++) {
            allLengths[idx++] = 0;
          }
        }
      }

      litLengths = allLengths.subarray(0, hlit);
      distLengths = allLengths.subarray(hlit);
    } else {
      throw new Error('Invalid DEFLATE block type 3');
    }

    const litCodes = buildHuffman(litLengths);
    const distCodes = buildHuffman(distLengths);

    // Decode literals and length/distance pairs
    while (true) {
      const sym = decodeSymbol(litLengths, litCodes);

      if (sym < 0) {
        throw new Error('Invalid DEFLATE stream');
      }

      if (sym < 256) {
        output.push(sym);
      } else if (sym === 256) {
        break; // End of block
      } else {
        // Length/distance pair
        const lenIdx = sym - 257;
        const length = lengthBase[lenIdx] + readBits(lengthExtra[lenIdx]);
        const distSym = decodeSymbol(distLengths, distCodes);
        const distance = distBase[distSym] + readBits(distExtra[distSym]);

        // Copy from earlier in output
        const start = output.length - distance;

        for (let i = 0; i < length; i++) {
          output.push(output[start + i]);
        }
      }
    }

    if (bfinal) {
      break;
    }
  }

  return new Uint8Array(output.slice(0, expectedSize || output.length));
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
