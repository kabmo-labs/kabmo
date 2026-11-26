/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /pair` — the page a phone's camera opens.
 *
 * This is what makes a pairing code usable WITHOUT a native scanner: the QR
 * encodes an `https://<address>/pair#<payload>` URL, the phone's own camera app
 * opens it in the browser, and this page redeems the code and lands the browser
 * on the console with a device cookie already set.
 *
 * The payload lives in the FRAGMENT, never the query string. A fragment is not
 * sent to the server, so the one-time secret never reaches an access log, a
 * proxy, or the `Referer` of anything this page loads. The page reads it with
 * `location.hash` and posts it once.
 *
 * No external assets and no framework: this page has to render on a phone that
 * has never reached this server before, over a link that may be slow, and a
 * bundle that fails to load would leave the user staring at a blank screen with
 * a code that is already burning its two minutes.
 */

import { NO_STORE_HEADERS } from '@kabmo-labs/kabmo-http';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Pair with Kabmo</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f7f5f0; color: #141310; }
  main { width: min(28rem, calc(100vw - 3rem)); padding: 1.5rem;
         border: 1px solid rgba(20,19,16,.12); border-radius: 14px; background: #fff; }
  h1 { margin: 0 0 .5rem; font-size: 1.05rem; }
  p { margin: 0; color: rgba(20,19,16,.65); font-size: .85rem; }
  a { display: inline-block; margin-top: 1rem; padding: .5rem .9rem; border-radius: 8px;
      background: #141310; color: #f7f5f0; text-decoration: none; font-weight: 600; font-size: .85rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #141310; color: #f7f5f0; }
    main { background: #1d1b17; border-color: rgba(247,245,240,.14); }
    p { color: rgba(247,245,240,.65); }
    a { background: #f7f5f0; color: #141310; }
  }
</style>
</head>
<body>
<main>
  <h1>Pair with Kabmo</h1>
  <p id="status">Pairing…</p>
  <a id="continue" href="/" hidden>Open the console</a>
</main>
<script>
(function () {
  var status = document.getElementById('status');
  var link = document.getElementById('continue');

  function fail(message) {
    status.textContent = message;
  }

  function decode(value) {
    var padded = value.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android device';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Browser';
  }

  function platform() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'macos';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux/.test(ua)) return 'linux';
    return 'web';
  }

  var raw = location.hash.slice(1);
  if (!raw) { fail('This link is missing its pairing code. Create a new one in Settings → Connect.'); return; }

  var payload;
  try {
    payload = JSON.parse(decode(raw));
  } catch (error) {
    fail('This link is not a Kabmo pairing code.');
    return;
  }
  if (!payload || !payload.pairingId || !payload.secret) {
    fail('This link is not a Kabmo pairing code.');
    return;
  }

  // Which candidate this page was opened from, and how fast it answers.
  //
  // The page is served BY the origin it is pairing with, so location.origin
  // matches exactly one candidate — this is a fact, not a guess. The round trip
  // is measured here because the server cannot measure a phone's latency, and
  // the device row's ROUTE/RTT columns are otherwise always empty.
  var route = null;
  var candidates = payload.candidates || [];
  for (var i = 0; i < candidates.length; i += 1) {
    if (candidates[i] && candidates[i].url === location.origin) { route = candidates[i].kind; break; }
  }

  function measure() {
    if (!window.performance || !performance.now) return Promise.resolve(null);
    var started = performance.now();
    return fetch('/api/health', { cache: 'no-store' })
      .then(function (response) { return response.ok ? Math.round(performance.now() - started) : null; })
      .catch(function () { return null; });
  }

  measure().then(function (rttMs) {
    var body = {
      pairingId: payload.pairingId,
      secret: payload.secret,
      name: deviceName(),
      platform: platform()
    };
    if (route) body.route = route;
    if (rttMs !== null) body.rttMs = rttMs;

    return fetch('/api/connect/pair/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (body) {
      if (!response.ok) {
        fail((body && body.error) || 'This pairing code could not be redeemed.');
        return;
      }
      status.textContent = 'Paired. Opening the console…';
      link.hidden = false;
      location.replace('/');
    });
  }).catch(function () {
    fail('Could not reach the server. Check that this device is on the same network or tailnet.');
  });
})();
</script>
</body>
</html>`;

export async function loader() {
  return new Response(PAGE, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...NO_STORE_HEADERS,
      // The page reads a fragment and posts it once; nothing it loads may leak
      // the URL onward.
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}
