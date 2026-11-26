import { describe, expect, test } from 'bun:test';
import { hashlinePatchFromArgs, hashlineTargetPath, parseHashlinePatch } from './hashline-patch';

/** Real args a model sent for `edit`: `{i, input}` with no delimiter wrapper. */
const REAL_INPUT = '[app/components/workspace/chat-timeline/UndoConfirmModal.tsx#A328]\nCUT 18.=18';

describe('parseHashlinePatch', () => {
  test('reads the header and a bodyless op from a wrapper-less patch', () => {
    const [section] = parseHashlinePatch(REAL_INPUT);
    expect(section.path).toBe('app/components/workspace/chat-timeline/UndoConfirmModal.tsx');
    expect(section.tag).toBe('A328');
    expect(section.removed).toBe(false);
    expect(section.ops).toEqual([{ verb: 'CUT', spec: '18.=18', body: [] }]);
  });

  test('keeps body rows verbatim — indent, blank and escaped markers', () => {
    const [section] = parseHashlinePatch(
      [
        '*** Begin Patch',
        '[app/x.ts#0a1b]',
        'PUT 3.=3:',
        '+  if (dry) return;',
        '+',
        '+- literal minus',
        '++ literal plus',
        '*** End Patch',
      ].join('\n'),
    );
    expect(section.ops).toHaveLength(1);
    expect(section.ops[0].verb).toBe('PUT');
    expect(section.ops[0].spec).toBe('3.=3');
    expect(section.ops[0].body).toEqual(['+  if (dry) return;', '+', '+- literal minus', '++ literal plus']);
  });

  test('treats REM and MV as section-level file ops', () => {
    const [section] = parseHashlinePatch('[app/old.ts#beef]\nREM');
    expect(section.removed).toBe(true);
    expect(section.ops).toEqual([]);

    const [moved] = parseHashlinePatch('[app/old.ts#beef]\nMV app/new.ts');
    expect(moved.moveTo).toBe('app/new.ts');
  });

  test('parses gap, block and register ops, and splits sections', () => {
    const sections = parseHashlinePatch(
      [
        '[app/a.ts#1111]',
        'PUT <4:',
        '+before',
        'PUT >$ @tail',
        '[app/b.ts#2222]',
        'PUT 7*:',
        '+replaced block',
      ].join('\n'),
    );
    expect(sections.map((s) => s.path)).toEqual(['app/a.ts', 'app/b.ts']);
    expect(sections[0].ops.map((op) => op.spec)).toEqual(['<4', '>$ @tail']);
    expect(sections[1].ops[0].spec).toBe('7*');
  });

  test('accepts a missing closing bracket and a quoted path', () => {
    expect(parseHashlinePatch('[app/x.ts#0000').at(0)?.path).toBe('app/x.ts');
    expect(parseHashlinePatch('["app/with space.ts"#0000]\nCUT 1.=1').at(0)?.path).toBe('app/with space.ts');
    expect(parseHashlinePatch('["app/with space.ts"]\nCUT 1.=1').at(0)?.path).toBe('app/with space.ts');
    // omp strips the tag before the quotes, so a tag *inside* the quotes stays
    // part of the path — mirrored here rather than silently "corrected".
    expect(parseHashlinePatch('["app/x.ts#0000"]\nCUT 1.=1').at(0)?.path).toBe('app/x.ts#0000');
    // Only a 4-hex suffix is a snapshot tag; anything else stays in the path.
    expect(parseHashlinePatch('[app/x.ts#HEAD]\nCUT 1.=1').at(0)?.path).toBe('app/x.ts#HEAD');
  });

  test('returns nothing for non-patch text', () => {
    expect(parseHashlinePatch('app/components/Foo.tsx')).toEqual([]);
    expect(parseHashlinePatch('')).toEqual([]);
  });
});

describe('hashline patch in tool args', () => {
  test('finds the patch under `input` and derives the target path', () => {
    const args = { i: 'Hapus deklarasi handler duplikat modal', input: REAL_INPUT };
    expect(hashlinePatchFromArgs(args)?.text).toBe(REAL_INPUT);
    expect(hashlineTargetPath(args)).toBe('app/components/workspace/chat-timeline/UndoConfirmModal.tsx');
  });

  test('ignores args that carry no hashline patch', () => {
    expect(hashlineTargetPath({ i: 'x', path: 'app/y.ts', old_string: 'a' })).toBeUndefined();
    expect(hashlineTargetPath(undefined)).toBeUndefined();
  });
});
