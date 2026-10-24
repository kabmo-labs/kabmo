/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The comment tokens `toggleComment` reads out of `languageData`.
 *
 * A wrong token is not a cosmetic bug: `//` inserted into YAML is a syntax
 * error, and a `//` inserted into CSS comments out nothing while breaking the
 * rule it was added to. The three shapes are asserted, plus the default that
 * every C-family grammar relies on.
 */

import { describe, expect, test } from 'bun:test';

import { commentSyntaxFor } from '@/shared/lib/code/editor/comment-syntax';

describe('commentSyntaxFor', () => {
  test('defaults to a line comment for the C-family', () => {
    expect(commentSyntaxFor('typescript')).toEqual({ line: '//' });
    expect(commentSyntaxFor('rust')).toEqual({ line: '//' });
    expect(commentSyntaxFor('not-a-language')).toEqual({ line: '//' });
  });

  test('names the languages whose line comment is not `//`', () => {
    expect(commentSyntaxFor('python')).toEqual({ line: '#' });
    expect(commentSyntaxFor('yaml')).toEqual({ line: '#' });
    expect(commentSyntaxFor('sql')).toEqual({ line: '--' });
  });

  test('wraps the languages that have only block comments', () => {
    expect(commentSyntaxFor('css')).toEqual({ block: ['/*', '*/'] });
    expect(commentSyntaxFor('html')).toEqual({ block: ['<!--', '-->'] });
    expect(commentSyntaxFor('markdown')).toEqual({ block: ['<!--', '-->'] });
  });
});
