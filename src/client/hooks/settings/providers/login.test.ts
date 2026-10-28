/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The login dialog's state rules, and the two shapes that made every device
 * flow fail.
 *
 * `open_url` ALWAYS carries `url`; `launchUrl` is an optional loopback shortcut
 * omp omits for manual-input-only flows and for non-loopback redirect URIs. A
 * client that keys on `launchUrl` cancels the login the moment it is absent —
 * and `instructions` is the only place a device flow says which code to type.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { canOpenLocally, deviceCodeOf } from '@/client/hooks/settings/providers/login';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

describe('deviceCodeOf', () => {
  test('lifts the code out of the instruction sentence', () => {
    expect(deviceCodeOf('Enter code: ABCD-1234')).toBe('ABCD-1234');
    expect(deviceCodeOf('To sign in, open the page and enter the code: WXYZ-9876')).toBe('WXYZ-9876');
  });

  test('a code keeps its hyphens and digits', () => {
    expect(deviceCodeOf('code: A1B2-C3D4')).toBe('A1B2-C3D4');
  });

  test('prose without a code yields nothing', () => {
    expect(deviceCodeOf('Waiting for the browser…')).toBeNull();
    expect(deviceCodeOf('')).toBeNull();
    expect(deviceCodeOf(null)).toBeNull();
  });
});

describe('canOpenLocally', () => {
  beforeEach(() => installDomGlobals(new Window({ url: 'http://127.0.0.1:3000/settings' })));
  afterEach(() => restoreDomGlobals());
  afterAll(() => restoreDomGlobals());

  /** The console's own host, which decides whether a loopback URL is usable. */
  function setHost(host: string): void {
    Object.defineProperty(window.location, 'hostname', { value: host, configurable: true });
  }


  test('a public URL is always openable', () => {
    setHost('kabmo.example.com');
    expect(canOpenLocally('https://github.com/login/device')).toBe(true);
  });

  test('a loopback URL is openable only from a loopback console', () => {
    // omp's callback server runs on the SERVER, so its launch URL is
    // 127.0.0.1 there. Opening it from a console on another machine reaches the
    // reader's localhost — a dead tab that looks like a broken login.
    setHost('127.0.0.1');
    expect(canOpenLocally('http://127.0.0.1:54545/launch')).toBe(true);
    setHost('kabmo.example.com');
    expect(canOpenLocally('http://127.0.0.1:54545/launch')).toBe(false);
  });

  test('localhost and its subdomains count as loopback', () => {
    setHost('app.localhost');
    expect(canOpenLocally('http://localhost:3000/launch')).toBe(true);
  });

  test('a non-http scheme is left to the browser', () => {
    setHost('kabmo.example.com');
    expect(canOpenLocally('vscode://callback?code=abc')).toBe(true);
  });

  test('an unparsable value is not opened', () => {
    setHost('127.0.0.1');
    expect(canOpenLocally('not a url')).toBe(false);
    expect(canOpenLocally(null)).toBe(false);
  });
});
