import { describe, expect, it } from 'vitest';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import type { PalmkitAction } from '~/types/actions';

/**
 * The asset action, which is how a generated picture becomes a project file.
 *
 * A `file` action carries its content in the stream. A JPEG cannot: base64 in
 * the response is enormous, and the response goes back into the model's
 * context. So this action carries a link, and the bytes are fetched in the
 * browser where they are actually needed.
 *
 * Without it the only way to use a generated image was to reference the
 * storage URL from the page — a link that expires in seven days, is missing
 * from an export, and leaves the site full of broken images.
 */

function parse(input: string) {
  const opened: PalmkitAction[] = [];
  const closed: PalmkitAction[] = [];

  const parser = new StreamingMessageParser({
    callbacks: {
      onActionOpen: (d) => opened.push(d.action),
      onActionClose: (d) => closed.push(d.action),
    },
  });

  parser.parse('msg-1', input);

  return { opened, closed };
}

const ASSET = (attrs: string) =>
  `<palmkitArtifact id="a" title="A"><palmkitAction ${attrs}></palmkitAction></palmkitArtifact>`;

describe('asset action parsing', () => {
  it('carries a path and a source', () => {
    const { closed } = parse(ASSET('type="asset" filePath="public/hero.jpg" src="https://store/1.jpg"'));

    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      type: 'asset',
      filePath: 'public/hero.jpg',
      src: 'https://store/1.jpg',
    });
  });

  /*
   * Both attributes are required and neither has a sensible default: without
   * a path there is nowhere to put the file, and without a src there is
   * nothing to put there. A file action can fall back to a generated
   * filename because it already holds its content; this one cannot.
   */
  it('rejects an asset with no source', () => {
    expect(() => parse(ASSET('type="asset" filePath="public/hero.jpg"'))).toThrow(/requires filePath and src/);
  });

  it('rejects an asset with no path', () => {
    expect(() => parse(ASSET('type="asset" src="https://store/1.jpg"'))).toThrow(/requires filePath and src/);
  });

  it('leaves file actions alone', () => {
    const { closed } = parse(
      '<palmkitArtifact id="a" title="A"><palmkitAction type="file" filePath="index.js">hi</palmkitAction></palmkitArtifact>',
    );

    /*
     * The parser appends a newline to file content; the point here is only
     * that a file action still parses as one.
     */
    expect(closed[0]).toMatchObject({ type: 'file', filePath: 'index.js' });
  });

  it('reads an asset alongside the files it belongs with', () => {
    const { closed } = parse(
      '<palmkitArtifact id="a" title="A">' +
        '<palmkitAction type="file" filePath="index.html">&lt;img src="/hero.jpg"&gt;</palmkitAction>' +
        '<palmkitAction type="asset" filePath="public/hero.jpg" src="https://store/1.jpg"></palmkitAction>' +
        '</palmkitArtifact>',
    );

    expect(closed.map((a) => a.type)).toEqual(['file', 'asset']);
  });
});

/**
 * The write itself, without a WebContainer.
 *
 * `#runAssetAction` is private and needs a live container, so what is checked
 * here is the conversion the file store depends on: binary files are held as
 * base64, and the bytes must survive the round trip exactly. A JPEG that
 * decodes to something else is a corrupt file that still looks like a file.
 */
describe('binary round trip', () => {
  it('preserves bytes through base64', () => {
    // A real JPEG header plus bytes that are not valid UTF-8.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x80, 0xfe, 0xc3]);

    let binary = '';

    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    const encoded = btoa(binary);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

    expect([...decoded]).toEqual([...bytes]);
  });

  /*
   * The naive conversion — passing the array straight to String.fromCharCode
   * or decoding as text first — mangles anything above 0x7f, which is most
   * of a compressed image.
   */
  it('does not lose high bytes the way a text decode would', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x80]);
    const viaText = new TextDecoder().decode(bytes);

    expect(viaText).not.toBe(String.fromCharCode(0xff, 0xfe, 0x80));
  });
});

describe('the model is told how to use it', () => {
  it('the build prompt explains saving assets rather than linking them', async () => {
    const { getSystemPrompt } = await import('~/lib/common/prompts/prompts');
    const prompt = getSystemPrompt('/home/project');

    expect(prompt).toContain('type="asset"');
    expect(prompt).toMatch(/NEVER put the generated "url" directly into the page/);
  });
});
