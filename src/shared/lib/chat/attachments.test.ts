/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Attachment metadata across the two representations the composer handles.
 *
 * A LIVE attachment carries `file: File`; a REPLAYED one — out of the queue row
 * or back out of committed history — does not, because `JSON.stringify(new
 * File(…))` is `{}`. Every accessor and every assembly path must therefore work
 * from the persisted display fields, which is what used to break: a queued or
 * retried send read `a.file.name` and threw, and the image payload filter
 * matched on a `data:` preview the composer never produces.
 */

import { describe, expect, test } from 'bun:test';
import type { Attachment } from '@/shared/types';
import {
  applyTextAttachmentBudget,
  attachmentHasPayload,
  attachmentImage,
  attachmentName,
  attachmentSize,
  attachmentType,
  composeMessageWithTextAttachments,
  isImageAttachment,
  isTextAttachment,
  looksLikeTextFile,
  prepareQueuedAttachments,
  readTextAttachments,
} from '@/shared/lib/chat/attachments';

function liveFile(name: string, body: string, type = ''): File {
  return new File([body], name, { type });
}

function liveAttachment(overrides: Partial<Attachment> & { id: string }): Attachment {
  return { preview: '', ...overrides };
}

/** What the queue row and committed history actually hold. */
function replayed(attachments: Attachment[]): Attachment[] {
  return JSON.parse(JSON.stringify(attachments)) as Attachment[];
}

describe('attachment metadata accessors', () => {
  test('read a live file, and fall back to the persisted fields', () => {
    const live = liveAttachment({ id: 'a', name: 'notes.md', type: 'text/markdown', size: 99, file: liveFile('notes.md', '# hi', 'text/markdown') });
    expect(attachmentName(live)).toBe('notes.md');
    expect(attachmentType(live)).toBe('text/markdown');
    expect(attachmentSize(live)).toBe(4); // the live handle is authoritative

    const replay = replayed([live])[0];
    // `JSON.stringify` renders a File as an empty object — not as undefined —
    // so the replay path must treat a truthiness check as unreliable and read
    // the display fields first.
    expect(replay.file as unknown).toEqual({});
    expect(attachmentName(replay)).toBe('notes.md');
    expect(attachmentType(replay)).toBe('text/markdown');
    expect(attachmentSize(replay)).toBe(99);
  });

  test('never throw on an attachment with neither a file nor a name', () => {
    const bare = { id: 'x', preview: '' } as Attachment;
    expect(attachmentName(bare)).toBe('attachment');
    expect(attachmentType(bare)).toBe('');
    expect(attachmentSize(bare)).toBe(0);
    expect(isTextAttachment(bare)).toBe(false);
    expect(attachmentImage(bare)).toBeNull();
  });
});

describe('text vs image classification', () => {
  test('code files with no browser MIME type still inline', () => {
    // `File.type` is empty for most source files, so the extension decides.
    for (const name of ['script.py', 'app.tsx', 'query.sql', 'Dockerfile.json', 'data.yaml']) {
      expect(isTextAttachment({ name, type: '', file: liveFile(name, 'x') })).toBe(true);
    }
  });

  test('a browser-reported text MIME type is enough on its own', () => {
    expect(isTextAttachment({ name: 'LICENSE', type: 'text/plain', file: liveFile('LICENSE', 'x', 'text/plain') })).toBe(true);
    expect(isTextAttachment({ name: 'blob.bin', type: 'application/json', file: liveFile('blob.bin', '{}', 'application/json') })).toBe(true);
  });

  test('binaries and images never consume the inline budget', () => {
    expect(isTextAttachment({ name: 'app.dmg', type: 'application/octet-stream', file: liveFile('app.dmg', 'x', 'application/octet-stream') })).toBe(false);
    // An image whose name happens to look textual is still an image.
    expect(isTextAttachment({ name: 'trap.md', type: 'image/png', file: liveFile('trap.md', 'x', 'image/png') })).toBe(false);
    expect(isImageAttachment({ name: 'trap.md', type: 'image/png', file: liveFile('trap.md', 'x', 'image/png') })).toBe(true);
  });
});

describe('image payloads', () => {
  test('carry the omp ImageContent type and the persisted MIME type', () => {
    const payload = attachmentImage({
      type: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
    });
    expect(payload).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  });

  test('a replay with a blob preview still yields its payload', () => {
    // The old server-side filter matched `preview.startsWith('data:image/')`
    // and so found nothing: the composer's preview is a blob URL.
    const [replay] = replayed([
      liveAttachment({ id: 'i', name: 's.png', type: 'image/png', preview: 'blob:http://x/1', dataBase64: 'AAAA', file: liveFile('s.png', 'x', 'image/png') }),
    ]);
    expect(attachmentImage(replay)?.data).toBe('AAAA');
  });

  test('an unread image yields nothing rather than a blank payload', () => {
    expect(attachmentImage({ type: 'image/png', dataBase64: '' })).toBeNull();
    expect(attachmentImage({ type: 'image/png' })).toBeNull();
  });

  test('a committed row whose preview IS the bytes still yields a payload', () => {
    // Committed history and the session loader set `preview` to a data URL and
    // never set `dataBase64`, so a retry or a seeded new chat had no image to
    // send. The preview is the only copy of the bytes on that path.
    const payload = attachmentImage({ type: 'image/png', preview: 'data:image/png;base64,QUJD' });
    expect(payload).toEqual({ type: 'image', data: 'QUJD', mimeType: 'image/png' });
  });

  test('a non-base64 or empty preview yields nothing', () => {
    expect(attachmentImage({ type: 'image/png', preview: 'blob:http://x/1' })).toBeNull();
    expect(attachmentImage({ type: 'image/png', preview: 'data:image/png;base64,' })).toBeNull();
  });
});

describe('attachmentHasPayload', () => {
  test('a replayed image with only a data-URL preview still counts as sendable', () => {
    // The composer used to test `content || dataBase64`, so a seeded or
    // replayed image — whose bytes live only in the preview — was refused and
    // the send aborted with "unreadable attachments".
    expect(attachmentHasPayload({ id: 'i', preview: 'data:image/png;base64,QUJD', type: 'image/png' })).toBe(true);
  });

  test('an image with no bytes at all is not sendable', () => {
    expect(attachmentHasPayload({ id: 'i', preview: 'blob:http://x/1', type: 'image/png' })).toBe(false);
  });

  test('a text file counts through its inlined content', () => {
    expect(attachmentHasPayload({ id: 't', preview: '', name: 'a.md', type: 'text/markdown', content: '# hi' })).toBe(true);
    expect(attachmentHasPayload({ id: 't', preview: '', name: 'a.md', type: 'text/markdown', content: '' })).toBe(false);
  });
});

describe('text contents', () => {
  test('are read from a live file, and from `content` on a replay', async () => {
    const live = [liveAttachment({ id: 't', name: 'notes.md', type: 'text/markdown', file: liveFile('notes.md', '# hi', 'text/markdown') })];
    expect((await readTextAttachments(live)).map((f) => f.content)).toEqual(['# hi']);

    const replay = replayed(await prepareQueuedAttachments(live));
    expect(replay[0].file).toBeUndefined();
    expect(replay[0].content).toBe('# hi');
    expect((await readTextAttachments(replay)).map((f) => f.content)).toEqual(['# hi']);
  });

  test('a replay without a persisted copy is flagged, not silently dropped', async () => {
    // It used to be filtered out, which sent a prompt naming a file whose
    // contents never arrived — with nothing in the UI to say so.
    const files = await readTextAttachments([
      { id: 't', name: 'notes.md', type: 'text/markdown', preview: '' },
    ]);
    expect(files.map((f) => ({ name: f.name, missing: f.missing, content: f.content }))).toEqual([
      { name: 'notes.md', missing: true, content: '' },
    ]);
  });

  test('carry their attachment id so the caller can map them back', async () => {
    const files = await readTextAttachments([
      { id: 'keep', name: 'a.md', type: 'text/markdown', preview: '', content: 'a' },
      { id: 'drop', name: 'b.bin', type: 'application/octet-stream', preview: '', content: 'b' },
    ]);
    expect(files.map((f) => f.id)).toEqual(['keep']);
  });

  test('are fenced with a language that matches the file', () => {
    const py = [{ name: 'script.py', mimeType: 'text/x-python', content: 'x=1', size: 3 }];
    expect(composeMessageWithTextAttachments('go', py)).toContain('```python');
  });
});

describe('inline budget', () => {
  test('counts replayed attachments, so repeated drops stop at the cap', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, type: 'text/markdown', size: 10, content: 'x' }));
    const { accepted, skipped } = applyTextAttachmentBudget([liveFile('extra.md', 'x', 'text/markdown')], existing);
    expect(accepted).toEqual([]);
    expect(skipped.map((f) => f.name)).toEqual(['extra.md']);
  });

  test('lets an image through when the text budget is spent', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, type: 'text/markdown', size: 10, content: 'x' }));
    const { accepted, skipped } = applyTextAttachmentBudget([liveFile('shot.png', 'x', 'image/png')], existing);
    expect(accepted.map((f) => f.name)).toEqual(['shot.png']);
    expect(skipped).toEqual([]);
  });
});

describe('content sniffing for unclassified files', () => {
  test('a file whose name and MIME say nothing is recognised as text', async () => {
    // A promised-file drag from another app arrives like this: real bytes, a
    // generic name, no usable type. Deciding from metadata alone left it
    // attached but never inlined.
    expect(await looksLikeTextFile(liveFile('document', 'IMPORTANT\ncode: ABC'))).toBe(true);
    expect(await looksLikeTextFile(liveFile('file', '# Title\n\nBody'))).toBe(true);
  });

  test('binary content is refused', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await looksLikeTextFile(new File([png], 'download'))).toBe(false);
    // A NUL byte is decisive: no text encoding this app handles contains one.
    expect(await looksLikeTextFile(new File([new Uint8Array([65, 66, 0, 67])], 'blob'))).toBe(false);
  });

  test('an empty file is not treated as text', async () => {
    expect(await looksLikeTextFile(liveFile('empty', ''))).toBe(false);
  });

  test('a sniffed attachment keeps its content through the read path', async () => {
    // The sniffer's verdict is recorded on the attachment at attach time, so the
    // send path must honour it even though the name still says nothing — and a
    // bare `content` string must NOT be enough to smuggle a binary through.
    const sniffed: Attachment = {
      id: 'x',
      name: 'document',
      type: '',
      size: 20,
      preview: '',
      content: 'IMPORTANT\ncode: ABC',
      sniffedText: true,
    };
    const read = await readTextAttachments([sniffed]);
    expect(read.map((f) => ({ name: f.name, content: f.content }))).toEqual([
      { name: 'document', content: 'IMPORTANT\ncode: ABC' },
    ]);
  });
});
