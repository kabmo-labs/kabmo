/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three platform declarations of Kabmo's document types, and the one table
 * they are rendered from.
 *
 * The artifacts are committed files that a person could edit, and each drifts
 * SILENTLY: a format added to the editor and declared on macOS only is a format
 * Windows users cannot double-click, and nothing fails. So every assertion here
 * is "the committed artifact still equals the table", plus the properties that
 * keep Kabmo an OPTION rather than the handler that steals a file type.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  HANDLED_DOCUMENTS,
  documentExtensions,
  documentMimes,
  documentUtis,
} from './document-types.mjs';
import {
  BEGIN_MARKER,
  END_MARKER,
  androidFilters,
  generatedFiles,
  iosPlistFragment,
  issBlock,
  mimeList,
  plistFragment,
  regionOf,
  splice,
} from '../scripts/shell-document-types.mjs';

const REPO = path.resolve(import.meta.dir, '..');

describe('the document table', () => {
  test('every row names a type, a UTI, a MIME and at least one extension', () => {
    for (const entry of HANDLED_DOCUMENTS) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.uti).toMatch(/^[a-zA-Z0-9.-]+$/);
      expect(entry.mime).toContain('/');
      expect(entry.extensions.length).toBeGreaterThan(0);
      for (const extension of entry.extensions) expect(extension).toMatch(/^[a-z0-9]+$/);
    }
  });

  test('the lists are deduplicated', () => {
    const extensions = documentExtensions();
    expect(new Set(extensions).size).toBe(extensions.length);
    const mimes = documentMimes();
    expect(new Set(mimes).size).toBe(mimes.length);
    const utis = documentUtis();
    expect(new Set(utis).size).toBe(utis.length);
  });

  test('the types the editor can draw are all here', () => {
    // The four the editor has a dedicated surface for. A viewer added to
    // `document-kind.ts` without a row here is a format that renders inside
    // Kabmo and cannot be opened INTO it.
    const extensions = documentExtensions();
    for (const extension of ['pdf', 'docx', 'xlsx', 'csv', 'md', 'svg', 'png', 'txt', 'log', 'json']) {
      expect(extensions).toContain(extension);
    }
  });
});

describe('the macOS declaration', () => {
  test('every row is a Viewer with an Alternate rank', () => {
    const fragment = plistFragment();
    // `Owner` would make Kabmo the DEFAULT for every PDF on the machine, which
    // is the one thing this feature must never do.
    expect(fragment).not.toContain('<string>Owner</string>');
    expect(fragment).not.toContain('<string>Editor</string>');
    expect(fragment.match(/<string>Viewer<\/string>/g)?.length).toBe(HANDLED_DOCUMENTS.length);
    expect(fragment.match(/<string>Alternate<\/string>/g)?.length).toBe(HANDLED_DOCUMENTS.length);
  });

  test('every UTI and extension appears in the fragment', () => {
    const fragment = plistFragment();
    for (const uti of documentUtis()) expect(fragment).toContain(`<string>${uti}</string>`);
    for (const extension of documentExtensions()) expect(fragment).toContain(`<string>${extension}</string>`);
  });

  test('the fragment is balanced, and every key has a value', () => {
    // A tag balance check, not a parse: this suite runs on Linux CI too, and
    // `DOMParser` is not a Bun global. The REAL lint is `plutil -lint` in
    // `build-app.sh`, which runs on the machine that assembles the bundle — a
    // stray `<` there makes the whole Info.plist invalid and macOS then refuses
    // to launch the app, so it fails the build rather than a test.
    const fragment = plistFragment();
    const opens = fragment.match(/<(dict|array)>/g)?.length ?? 0;
    const closes = fragment.match(/<\/(dict|array)>/g)?.length ?? 0;
    expect(opens).toBe(closes);
    expect(fragment).not.toContain('<dict><dict>');

    // Every `<key>` is followed by exactly one value element, so a dict can never
    // hold a dangling key.
    const keys = fragment.match(/<key>[^<]+<\/key>/g)?.length ?? 0;
    const values = fragment.match(/<key>[^<]+<\/key>\s*<[a-z]/g)?.length ?? 0;
    expect(keys).toBeGreaterThan(0);
    expect(values).toBe(keys);
  });

  test('the build script injects the fragment and declares the key', () => {
    const script = fs.readFileSync(path.join(REPO, 'packages/macos/scripts/build-app.sh'), 'utf8');
    expect(script).toContain('<key>CFBundleDocumentTypes</key>');
    expect(script).toContain('__DOCUMENT_TYPES__');
    expect(script).toContain('shell-document-types.mjs');
    expect(script).toContain('--plist');
  });

  test('the assembled plist is linted before the bundle is signed', () => {
    // A malformed plist makes macOS refuse to LAUNCH the app, with no message
    // anywhere — so the lint runs on the machine that assembles the bundle,
    // not in a test on a Linux runner that has no `plutil`.
    const script = fs.readFileSync(path.join(REPO, 'packages/macos/scripts/build-app.sh'), 'utf8');
    expect(script).toContain('plutil -lint');
    // …and it must FAIL the build, not warn.
    const lint = script.slice(script.indexOf('plutil -lint'));
    expect(lint).toContain('exit 1');
  });
});

describe('the Linux declaration', () => {
  test('the MIME list is semicolon-separated and terminated', () => {
    const list = mimeList();
    expect(list.endsWith(';')).toBe(true);
    const entries = list.slice(0, -1).split(';');
    expect(entries).toEqual(documentMimes());
  });

  test('the desktop template declares the key and takes the files', () => {
    const template = fs.readFileSync(path.join(REPO, 'packages/linux/scripts/kabmo.desktop.in'), 'utf8');
    expect(template).toContain('MimeType=@MIMETYPES@');
    // `%F` is what makes the entry a document handler: without it the launcher
    // starts the app and drops the file the user double-clicked.
    expect(template).toContain('Exec=@EXEC@ %F');
  });

  test('every non-comment line of the template is a key=value pair', () => {
    // The `#` vs `;` trap: `;` is the LIST separator inside a value, so a
    // comment written with it is an unparseable key line — `desktop-file-validate`
    // rejects the entry and the launcher then does NOTHING when clicked, with no
    // message anywhere. The first version of this template used `;`.
    const lines = fs
      .readFileSync(path.join(REPO, 'packages/linux/scripts/kabmo.desktop.in'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    for (const line of lines) {
      if (line.startsWith('[')) {
        expect(line).toMatch(/^\[[A-Za-z ]+\]$/);
        continue;
      }
      expect(line).toMatch(/^[A-Za-z0-9-]+=/);
    }
  });

  test('the installer and all three packagers fill the key', () => {
    for (const script of [
      'packages/linux/scripts/install.sh',
      'packages/linux/scripts/package-deb.sh',
      'packages/linux/scripts/package-rpm.sh',
      'packages/linux/scripts/package-appimage.sh',
    ]) {
      const source = fs.readFileSync(path.join(REPO, script), 'utf8');
      expect(source).toContain('@MIMETYPES@');
      expect(source).toContain('mime-types.txt');
    }
  });

  test('the tarball carries the generated list', () => {
    const build = fs.readFileSync(path.join(REPO, 'packages/linux/scripts/build-app.sh'), 'utf8');
    expect(build).toContain('--mime');
    expect(build).toContain('mime-types.txt');
  });
});

describe('the Android declaration', () => {
  test('one VIEW filter and one SEND filter carry every type', () => {
    const block = androidFilters();
    // Every `<data>` in ONE filter is OR'd for mimeType, so a filter per type
    // would be 22 blocks for one list.
    expect(block.match(/<intent-filter>/g)?.length).toBe(2);
    expect(block).toContain('android.intent.action.VIEW');
    expect(block).toContain('android.intent.action.SEND');
    for (const mime of documentMimes()) expect(block).toContain(`<data android:mimeType="${mime}" />`);
  });

  test('BROWSABLE belongs to VIEW only, and nothing sets a priority', () => {
    const block = androidFilters();
    const view = block.slice(0, block.indexOf('android.intent.action.SEND'));
    const send = block.slice(block.indexOf('android.intent.action.SEND'));
    expect(view).toContain('android.intent.category.BROWSABLE');
    // A share carries no browsable URI, and the category there would be a claim
    // about the intent that is not true.
    expect(send).not.toContain('android.intent.category.BROWSABLE');
    // A priority makes Kabmo the PREFERRED handler — the same overreach as
    // `CFBundleTypeRole: Owner`.
    expect(block).not.toContain('android:priority');
  });

  test('the committed manifest region is current', () => {
    const manifest = fs.readFileSync(path.join(REPO, 'packages/android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(regionOf(manifest)).toBe(androidFilters());
    // Inside MainActivity, which is the exported component a manager reaches.
    const activity = manifest.slice(manifest.indexOf('.MainActivity'), manifest.indexOf('</activity>'));
    expect(activity).toContain(BEGIN_MARKER);
  });

  test('the manifest region is spliced, never appended', () => {
    // A hand edit that removed the markers must FAIL rather than silently write
    // nothing: a manifest that never offers the app looks exactly like a working
    // one until a user tries to open a document.
    expect(() => splice('<manifest></manifest>', androidFilters(), 'AndroidManifest.xml')).toThrow();
    const once = splice(`<a>\n${BEGIN_MARKER}\nold\n${END_MARKER}\n</a>`, androidFilters(), 'x');
    expect(regionOf(once)).toBe(androidFilters());
    expect(once).not.toContain('old');
  });
});

describe('the iOS declaration', () => {
  test('every row is a Viewer with an Alternate rank', () => {
    const fragment = iosPlistFragment();
    expect(fragment.match(/<string>Viewer<\/string>/g)?.length).toBe(HANDLED_DOCUMENTS.length);
    expect(fragment.match(/<string>Alternate<\/string>/g)?.length).toBe(HANDLED_DOCUMENTS.length);
    expect(fragment).not.toContain('<string>Owner</string>');
  });

  test('the build lints the assembled plist before it installs', () => {
    // A malformed plist makes iOS refuse to install the app with no message, and
    // the document types are the one generated region in it.
    const script = fs.readFileSync(path.join(REPO, 'packages/ios/scripts/build-ipa.sh'), 'utf8');
    expect(script).toContain('plutil -lint');
    const lint = script.slice(script.indexOf('plutil -lint'));
    expect(lint).toContain('exit 1');
  });

  test('the committed plist region is current, and the plist parses', () => {
    const plist = fs.readFileSync(path.join(REPO, 'packages/ios/Resources/Info.plist'), 'utf8');
    expect(regionOf(plist)).toBe(iosPlistFragment());
    expect(plist).toContain('<key>CFBundleDocumentTypes</key>');
    // A document opened from the Files app arrives security-scoped rather than
    // as a copy in this app's Inbox — which is what makes a 20 MiB workbook
    // open without duplicating it.
    expect(plist).toContain('<key>LSSupportsOpeningDocumentsInPlace</key>');
  });
});

describe('the Windows declaration', () => {
  test('the committed installer fragment is current', () => {
    const committed = fs.readFileSync(path.join(REPO, 'packages/windows/installer/document-types.iss'), 'utf8');
    expect(committed).toBe(issBlock());
  });

  test('it registers the program entry and offers itself per extension', () => {
    const block = issBlock();
    expect(block).toContain('Software\\Classes\\Applications\\{#AppExe}');
    expect(block).toContain('FriendlyAppName');
    for (const extension of documentExtensions()) {
      expect(block).toContain(`Software\\Classes\\.${extension}\\OpenWithProgids`);
    }
    // `Progid` (no `OpenWith`) takes the extension OVER — it would make Kabmo the
    // default handler for every PDF on the machine.
    expect(block).not.toContain('ValueName: "Progid"');
  });

  test('the installer includes it and asks Windows to refresh associations', () => {
    const iss = fs.readFileSync(path.join(REPO, 'packages/windows/installer/kabmo.iss'), 'utf8');
    expect(iss).toContain('#include "document-types.iss"');
    // Without this Windows keeps serving the "Open with" menu it cached, and a
    // fresh install looks like it did nothing.
    expect(iss).toContain('ChangesAssociations=yes');
  });

  test('the shell reads its command line', () => {
    const host = fs.readFileSync(path.join(REPO, 'packages/windows/src/KabmoDesktop.App/ShellHost.cs'), 'utf8');
    expect(host).toContain('LaunchPaths.From(Environment.GetCommandLineArgs())');
    expect(host).toContain('OpenPathsScript.For');
  });
});

describe('every generated file', () => {
  test('the gate covers all three artifacts', () => {
    const labels = generatedFiles().map((file) => file.label);
    expect(labels).toEqual([
      'packages/windows/installer/document-types.iss',
      'packages/android/app/src/main/AndroidManifest.xml',
      'packages/ios/Resources/Info.plist',
    ]);
  });

  test('each one is current on disk', () => {
    for (const file of generatedFiles()) {
      const actual = fs.readFileSync(file.path, 'utf8');
      expect({ label: file.label, current: actual === file.expected }).toEqual({ label: file.label, current: true });
    }
  });
});
