# End-to-end transport security for Kabmo shells, and QR pairing

**Status: research only — nothing here is implemented.**
Every number marked ⟦measured⟧ was produced on this machine (macOS 27 / arm64,
Bun 1.4.3, OpenSSL 4.0.3) with the scripts listed in
[Verification log](#verification-log). Loopback throughput is CPU-bound and is
there to show *ratios*, not what a phone or a Wi-Fi link achieves. Claims about
this repository cite the file and the symbol that state them.

---

## 1. The question

The shells (Android APK, iOS, macOS, Windows, Linux) are webviews pointed at a
Kabmo server. Today that is plain HTTP unless the operator passes `--tls`, and
even then the certificate is self-signed, so no shell accepts it. The ask:

- end-to-end encryption for data in transit between a shell and a server,
- a QR code that connects a phone without typing an address,
- evidence about what either costs in throughput and latency,
- with the goal of closing the "served over HTTP" gap.

---

## 2. TL;DR

| # | Finding | Evidence |
|---|---|---|
| 1 | The gap is **not** that TLS is missing — it is that `--tls` is **unusable from all five shells**: every one refuses a self-signed certificate, and a browser only gets through by clicking past a warning. | §3.2 |
| 2 | An app-layer "E2E" implemented *in the page* cannot be the answer: on `http://192.168.x.x` the engine has **no `crypto.subtle` at all**, and an active attacker on the same channel can rewrite the very JavaScript that would do the encrypting. | §4 ⟦measured⟧ |
| 3 | The correct design is **TLS + a pinned identity delivered out of band by the QR code**. QR replaces the *CA*, not TLS. It is the Syncthing model (device ID = certificate hash) with the phone as the trusting side. | §5 |
| 4 | TLS costs **almost nothing on the chat stream** and shows only on bulk transfer over loopback: **+2 µs** per WebSocket round trip, **+24 B** per 200 B frame, **0.19 s of CPU per GiB**. | §6 ⟦measured⟧ |
| 5 | The real cost on the wire is **Kabmo's own stream format**, not encryption: one 300-word answer is **15.1 MB** in `full` mode, and the realtime socket negotiates **no compression at all**. gzip/zstd take it to 2.3 / 1.4 MB. | §6.6 ⟦measured⟧ |
| 6 | Device identity beyond "the server is authentic" is available cheaply: **mTLS works in Bun** (`requestCert: true` refuses a client with no certificate, accepts one issued by the CA), on HTTP **and** on the WebSocket client. | §6.8 ⟦measured⟧ |
| 7 | The honest limit: on **Android**, WebView pinning is reachable only through the *error* callback, so a certificate signed by a root the device already trusts (corporate MITM) is never inspected. Full active-MITM resistance there needs a native network path, not a webview. | §5.4, §8 |

Recommended: **Tier 1 (QR + fingerprint pinning) closes the reported gap** for
every shell; **Tier 2 (mTLS device certificates)** adds "only paired devices can
connect"; **Tier 3 (native E2E proxy)** is the only design that survives a
hostile tunnel or a compromised CA, and it is a large change — see §7.

---

## 3. What exists today

### 3.1 Server

- **Optional TLS**: `src/server/lib/lifecycle/tls.ts` — `--tls`, certificate at
  `<data>/tls/cert.pem`, generated once with `openssl req -x509 -newkey
  rsa:2048` and **never regenerated** (`ensureTlsCertificate` reuses an existing
  pair unconditionally). SANs: `localhost`, `127.0.0.1`, `::1`, plus each
  non-internal IPv4 address.
- **One listener** for the API, SSE/WebSocket routes and the client bundle:
  `src/server/index.ts` (`Bun.serve` via Elysia, with `tls` spread in).
- **Auth**: password → argon2id, stateless HMAC session cookie
  `v1.<expiresAt>.<fingerprint>.<mac>` (`src/server/lib/auth/token.ts`).
  `Secure` is set only when the request arrived over https
  (`isSecureRequest`), i.e. on plain HTTP the session cookie is sent in the clear.
- **Login throttling** by socket address: 10 failures / 5 min → 15 min lockout
  (`src/server/lib/auth/rate-limit.ts`).
- **WS upgrades** are same-origin checked (`src/server/lib/http/same-origin.ts`),
  and the auth gate covers them. Note the check **allows a missing `Origin`**
  (`if (!origin) return true`) — which is correct for curl/tests but means it is
  not an authentication control against a non-browser attacker.
- **The CLI already warns** (`src/cli/lib/ui-password.js`, `reportUiAuth`) that a
  non-loopback bind without TLS sends the password and cookie in cleartext, and
  suggests `--tls` or a tunnel.

### 3.2 Shells — every one refuses the self-signed certificate

| Shell | Behaviour on an unknown issuer | File |
|---|---|---|
| Android | `handler.cancel()`, then a dialog naming the reason | `packages/android/app/src/main/java/dev/kabmo/shell/KabmoWebViewClient.kt:84` |
| iOS | `.cancelAuthenticationChallenge` | `packages/ios/Sources/kabmo-shell/ShellNavigationDelegate.swift:138` |
| macOS | no challenge handler → WebKit default refusal, reported as `SplashFailure` | `packages/macos/Sources/KabmoDesktop/SplashState.swift:179` |
| Windows | no `ServerCertificateErrorDetected` handler → WebView2 interstitial | `packages/windows/src/KabmoDesktop.App/ShellHost.cs:320` |
| Linux | no `load-failed-with-tls-errors` handler → the load fails | `packages/linux/src/splash.rs:201` |

So `--tls` today helps exactly one client: a desktop browser, after the operator
clicks through a warning — the habit that makes a real MITM work. **The shells
cannot use the one encryption mode that exists.**

Additionally, cleartext is deliberately permitted app-wide on the mobile
shells (`packages/android/app/src/main/res/xml/network_security_config.xml`,
`packages/ios/Resources/Info.plist` `NSAllowsArbitraryLoadsInWebContent`), since
the address is typed at runtime.

### 3.3 What a LAN http origin costs, beyond confidentiality

Measured in Chromium (Blink), Pixel 7 profile:

| API | `http://127.0.0.1` | `http://192.168.18.76` |
|---|---|---|
| `isSecureContext` | `true` | **`false`** |
| `crypto.subtle` | available | **`undefined`** |
| `navigator.mediaDevices` / `getUserMedia` | available | **`undefined`** |
| `navigator.clipboard.readText` | available | **`undefined`** |
| `serviceWorker` | available | **`false`** |
| `WebSocket`, `RTCPeerConnection`, `WebAssembly` | available | available |

Consequences that are product features, not theory:

- **dictation** is unavailable (already documented in the manifest comment),
- **copy/paste** degrades to `execCommand` (`src/client/hooks/ui/clipboard.ts`),
- **the QR scanner cannot be a web feature** — a camera needs `getUserMedia`,
  which a LAN http origin does not have. Pairing must scan **natively**.
- an in-page E2E has no AES-GCM at all; it would need pure-JS crypto, at the
  cost measured in §6.5.

---

## 4. Why "E2E in the page" is not the answer

A webview shell renders HTML that the server sends. If that channel is
attacker-controlled:

1. the attacker can rewrite the JavaScript that implements the encryption,
2. the attacker can replace the key-exchange logic,
3. the attacker sees the plaintext before it is encrypted.

There is no cryptographic trick around this: **the code and the data travel on
the same channel.** Benchmarked pure-JS crypto is irrelevant to that argument,
but it also bounds what is implementable:

| Primitive | Native (BoringSSL) | WebCrypto (`crypto.subtle`) | Pure JS (`@noble`) |
|---|---|---|---|
| AES-256-GCM 256 B | 0.6 µs | 8.6 µs | 20 µs (~17 MB/s) |
| AES-256-GCM 16 KiB | 2.6 µs | 11.6 µs | 70 µs (~62 MB/s) |
| AES-256-GCM 256 KiB | — | 56.9 µs | 3.0 ms (~87 MB/s) |
| X25519 ECDH | 16.4 µs | 26.3 µs | 187.5 µs |
| P-256 ECDH | 30.7 µs | 33.5 µs | n/a |
| HKDF-SHA256 (32 B) | 0.5 µs | 7.8 µs | 6.1 µs |

⟦measured⟧. The pure-JS column is the *only* one available on a LAN http
origin. It is fine for chat frames and hopeless for a file transfer.

**Where app-layer E2E is genuinely useful:** the JS itself is delivered over an
authenticated channel (i.e. TLS is already in place) *and* something in the
middle terminates that TLS — a `cloudflared` tunnel, a corporate proxy, a
reverse proxy on a VPS. Then a second layer whose key only the client and the
server hold is the only way to keep the tunnel operator out. That is Tier 3 in §7, and it
belongs in the **native shell**, not the page.

---

## 5. QR connect — the design

### 5.1 What the QR carries

```
kabmo://pair?u=https%3A%2F%2F192.168.1.20%3A3000&f=<sha256(spki) b64url>&s=<32B one-time secret>&n=rajeb-macbook
```

- `u` — origin the shell will load (same normalisation the shells already apply:
  `normaliseUrl` in `packages/macos/Sources/KabmoDesktop/Store.swift`, etc.).
- `f` — **SHA-256 of the certificate's SubjectPublicKeyInfo**, the pin. Not the
  whole certificate: an SPKI pin survives a re-issue with the same key and is
  what both Android's and Apple's APIs make easy to compute.
- `s` — a one-time secret that authorises *this* pairing, so a QR photographed
  from a screen at the wrong moment cannot enrol a device later. TTL ~2 min,
  single use.
- `n` — the server's display name, so the phone can label it.

Measured sizes ⟦measured⟧:

| Payload | Bytes | QR version (EC M) | Modules | Render at 4 px/module |
|---|---|---|---|---|
| origin only | 25 | 2 | 25×25 | 100 px |
| origin + fingerprint | 94 | 6 | 41×41 | 164 px |
| origin + fingerprint + secret | 140 | 8 | 49×49 | 196 px |
| + display name | 156 | 8 | 49×49 | 196 px |

At EC Q the last shape is v11 / 61×61 / 244 px. **The payload is small enough
that no compression or chunking is needed**; a 196–250 px code scans from a
laptop screen at arm's length. Encode cost 1.2 ms.

### 5.2 Why QR and not a PIN / magic-wormhole

A short typed code needs a PAKE (SPAKE2, RFC 9382) because the code crosses the
same untrusted channel it is meant to secure. A QR is **out of band by
construction**: the phone reads it with its own camera, from a screen the
attacker does not control. So the QR can carry the long-term secret directly and
no PAKE is needed — simpler, and strictly stronger (no offline-guessable
password).

### 5.3 Flow

```
desktop (authenticated, already trusted by the user)
  GET /api/pair/qr            → { origin, fingerprint, secret, expiresAt }, rendered as SVG
  |  user shows it on screen
phone shell
  scans (native camera) → stores { origin, fingerprint }
  TLS connect with the certificate pinned to `fingerprint`   ← the pin is the trust
  POST /api/pair/claim { secret, deviceName, deviceKey }     → 201, device enrolled
  reload the origin; the webview now loads over https, pinned, authenticated
```

The pin is what turns a self-signed certificate into a verifiable one: the
certificate is *expected*, not merely *unknown*. Every later load compares
against the stored pin and fails closed on a mismatch.

### 5.4 Per-platform pinning — what is actually reachable

| Platform | API | Verdict |
|---|---|---|
| iOS / macOS (WKWebView) | `didReceive challenge` → `SecTrustCopyCertificateChain` → compare SPKI → `URLCredential(trust:)` | complete: the challenge fires on **every** TLS connection |
| Windows (WebView2) | `CoreWebView2.ServerCertificateErrorDetected` → the event's `ServerCertificate` bytes (base64 DER in recent SDKs — confirm the member name against the installed WebView2 SDK) → compare → `AlwaysAllow` | complete for error cases; also fires only on errors |
| Linux (WebKitGTK) | `WebView::load-failed-with-tls-errors` → `webkit_web_context_allow_tls_certificate_for_host` | complete for error cases |
| Android (WebView) | `WebViewClient.onReceivedSslError` → `SslError.getCertificate()` → raw DER from the `x509-certificate` entry of `SslCertificate.saveState()` → compare → `handler.proceed()` | **error path only** |

The Android caveat matters: `onReceivedSslError` is invoked when the certificate
**fails** validation. A MITM presenting a certificate signed by a root the device
trusts — an installed corporate/AV root, a user-installed CA — produces *no
error*, so the pin never runs and the WebView accepts it. WebView does not expose
a general trust-manager hook. OWASP flags unconditional `proceed()` as the bug;
a fingerprint-checked `proceed()` is the accepted way to accept *one known*
self-signed certificate, and it is what this design uses — but it does not
close the "publicly trusted MITM root" case.

If that case is in scope on Android, the only complete answer is not a webview
feature: see Tier 3 in §7.

### 5.5 Scanning must be native

`getUserMedia` is unavailable on a LAN http origin (§3.3), and the camera should
not be a page capability in this context anyway.

- Android: `CAMERA` permission (not in the manifest today) + CameraX + ML Kit
  barcode (or ZXing, no Play Services needed). Requires the origin to be
  reachable *before* pairing — which it is, it is in the QR.
- iOS: `NSCameraUsageDescription` (not in the plist today) +
  `AVCaptureMetadataOutput` (built in).
- Desktop shells: do not need a scanner — they show the QR.

Reference cost of a decode in JS, as an upper bound: **12.5 ms p50 / 44.4 ms p95**
for a 1280×720 frame with `jsQR` ⟦measured⟧. Native decoders are faster.

---

## 6. Benchmarks

Environment: macOS 27, Apple silicon, Bun 1.4.3, OpenSSL 4.0.3, loopback.
Loopback is CPU-bound (gigabytes/s); the ratios are the signal, and TLS cost is
irrelevant once a real link is the bottleneck.

### 6.1 Bulk HTTP vs HTTPS (64 MiB response)

| | median |
|---|---|
| http | 5221 MB/s |
| https | 3769 MB/s |
| TLS cost | **−27.8 %** (loopback only) |

Upload 5 MiB (editor save / attachment): 2117 MB/s → 2165 MB/s — no measurable
loss (the body is dominated by the same copy path).

### 6.2 WebSocket: latency and bulk

| | RTT p50 | 64 MiB, 64 KiB frames |
|---|---|---|
| ws | 15.0 µs | 1039 MB/s |
| wss | 17.1 µs | 645 MB/s |

⟦measured⟧ — TLS adds **+2.1 µs** per round trip, i.e. nothing that a phone's
network can notice (a LAN RTT is 1–5 ms, Wi-Fi 2–10 ms).

Frame-size sensitivity (64 MiB, loopback):

| frame | ws | wss |
|---|---|---|
| 64 B (PTY echo) | 62 MB/s | 66 MB/s |
| 4 KiB | 617 MB/s | 589 MB/s |
| 64 KiB (file cat) | 1251 MB/s | 703 MB/s (−44 %) |

Small frames are latency-bound (131 072 frames in 1 s); large frames are
CPU-bound, which is exactly where a loopback shows TLS's cost and a real link
would not.

Per-frame cost at chat sizes (round trip, loopback): 200 B 23 µs, 1 KiB 20 µs,
7.4 KiB 24 µs, 64 KiB 44 µs — wss p50 20/23/28/77 µs. Again: TLS is not the
variable; frame count is.

**The real server, measured on its own channel** (`--tls`, MOCK, temp data dir):
`subscribe → snapshot` 0.62 ms with a 3.6 KiB sidebar payload; an application
`ping → pong` settles to **0.1 ms** on a warm socket (first frames 1.1–2.0 ms).
Long runs of pings show p95 in the hundreds of milliseconds and occasional
multi-second outliers, in **both** `ws` and `wss` — that is the MOCK server's own
event loop (session scan, watchers, scheduler), not the transport. Worth knowing
before anyone attributes stream latency to encryption.

### 6.3 Wire overhead per frame

Measured with a TCP meter in front of the server (both directions divided by
frame count):

| payload | ws | wss | delta |
|---|---|---|---|
| 200 B | 412 B/frame | 436 B/frame | **+24 B (+6 %)** |
| 4 KiB | 8204 B/frame | 8219 B/frame | +15 B (+0.2 %) |

This matches the TLS 1.3 record shape (5 B header + 16 B AEAD tag = 21 B/record)
plus the WebSocket header — composed, not accumulated per frame when frames
coalesce into one record.

### 6.4 CPU cost per GiB

| | throughput | CPU |
|---|---|---|
| http | 3887 MB/s | 0.36 s/GiB |
| https | 3039 MB/s | 0.56 s/GiB |

TLS adds **0.19 s of CPU per GiB**. At a realistic 50 MB/s link that is ~1 % of
one core; at a 4G link it is noise.

### 6.5 Handshakes

| | p50 | p95 |
|---|---|---|
| http fresh connection | 0.12 ms | 0.19 ms |
| https fresh (TLS 1.3) | 0.37 ms | 0.43 ms |
| https keep-alive | 0.04 ms | 0.06 ms |

Concurrent fresh connections: 500 in 33 ms with TLS (15 063/s) vs 14 ms without.

Certificate algorithm — `ensureTlsCertificate` generates **RSA-2048** today:

| key | handshake p50 |
|---|---|
| RSA-2048 | 0.73 ms |
| P-256 | 0.34 ms (**53 % faster**) |

EC is the better default on a phone: smaller certificate, less CPU, and every
platform in §5.4 handles it.

### 6.6 The cost that actually matters: the stream itself

`configureChild` asks omp for `messageUpdates: "full"` — every
`message_update` carries the whole accumulated message. Modelled on a 300-word
answer with thinking and a tool call, 2217 frames (the frame count measured on a
real run and recorded in `child-config.ts`):

| | bytes |
|---|---|
| raw | **15.08 MB** |
| gzip (per frame) | 2.33 MB (6.5×), 41 ms of CPU total |
| zstd (per frame) | 1.43 MB (10.5×), 23 ms of CPU total |
| average frame | 6.6 KiB |

⟦measured⟧. And on the real server, **no WebSocket compression is negotiated at
all** — the handshake answers `extensions: ""` ⟦measured against a live
instance⟧. So ~10.9–15 MB crosses the wire per answer, uncompressed.

`perMessageDeflate` is supported by Bun and costs, at a 6.4 KiB frame:

| | per frame | wire |
|---|---|---|
| off | 21 µs (48 438 fps) | 6.4 KiB |
| on | 25 µs (39 998 fps) | 0.2 KiB |

**+21 % CPU per frame, ~30× smaller.** Bun negotiates
`server_no_context_takeover; client_no_context_takeover`, which caps the ratio
but bounds memory — the right trade for a long-lived stream.

This is the single largest throughput lever found, and it is orthogonal to
encryption. For reference, on a 4G link (2.5 MB/s) a 15 MB answer spends ~6 s in
bytes alone; at 1.4 MB it spends ~0.6 s.

Alternative (not recommended now): omp's `delta` projection is ~101× smaller
(108 KB / 486 frames vs 10.9 MB / 2217) but drops the tool-call identity, which
was measured to break the streaming tool card (`child-config.ts` documents the
failure). Compression gets most of the win without that cost.

### 6.7 App-layer encryption, for completeness

Envelope = 12 B nonce + ciphertext + 16 B tag, AES-256-GCM per WebSocket frame,
Bun/OpenSSL:

| shape | throughput |
|---|---|
| plain ws, 64 KiB frames | 935 MB/s |
| ws + AES-GCM envelope | 790 MB/s (**−15.5 %**) |
| wss | 645 MB/s |
| wss + envelope | (stacks the two: ≈ −40 % vs plain) |

Per frame at 7.4 KiB: 24 µs plain → 41 µs sealed. Not a throughput argument
against it — the argument against it is §4: over the same channel it protects
nothing, and under TLS it buys nothing.

### 6.8 mTLS

Verified end to end against Bun 1.4.3 with a local CA:

| client | server (`requestCert:true, rejectUnauthorized:true, ca:<CA>`) |
|---|---|
| no client certificate | connection refused (`ECONNRESET`) |
| certificate signed by the CA | `200 ok` |
| same, over the WebSocket client | connection refused / `open + echoed` |

⟦measured⟧. This is the property that makes Tier 2 possible: an unpaired device
cannot even complete a handshake, so it never reaches a route or the auth gate.

### 6.9 QR

| step | cost |
|---|---|
| encode (server) | 1.2–5.7 ms |
| PNG 480×480 | 5.5 KB |
| decode 1280×720 (jsQR, JS) | 12.5 ms p50, 44.4 ms p95 |
| full pairing exchange without camera | ~25 ms (keygen + QR + ECDH + HKDF + proof) |

---

## 7. Recommendation

### Tier 1 — TLS everywhere + QR-delivered pinning (closes the reported gap)

1. **Server**
   - `ensureTlsCertificate`: generate **EC P-256** instead of RSA-2048 (measured
     2.1× cheaper handshake). Keep the reuse rule: regenerating silently breaks
     every pin, so regeneration must be an explicit action with a re-pair prompt.
   - Expose the SPKI fingerprint on `/api/health` and in the boot banner, so a
     human can compare what the phone pinned.
   - `GET /api/pair/qr` (authenticated): `{ origin, fingerprint, secret,
     expiresAt }`, rendered as SVG; `POST /api/pair/claim` consumes the secret
     once and records the device.
   - Make `--tls` the default for a non-loopback bind, or at minimum make the
     warning a hard refusal the operator must override (`--insecure`). The
     existing warning text is already correct; it is just ignorable.
2. **Each shell**
   - Store `{ origin, fingerprint }` beside the URL it already stores
     (`ServerConfig.kt`, `ShellSettings.swift`, `Store.swift`, the Windows/Linux
     stores).
   - Implement the pin check from §5.4. On a mismatch: refuse, show the
     fingerprint, and require an explicit re-pair — never a click-through.
   - Native QR scan (§5.5) writing both values.
3. **Browser path (not a shell)** — the remaining hole. A browser cannot pin. The
   options, in order of cost: a local CA the user installs once (mkcert-style),
   a tunnel, or a public certificate for a name that resolves to the server.
   Worth documenting as "browser access stays certificate-warning-based" rather
   than pretending it is solved.

### Tier 2 — device identity (mTLS)

Pairing issues a client certificate for the device (from a Kabmo CA generated
beside the server certificate); the listener runs with `requestCert: true`,
`rejectUnauthorized: true`, `ca: <Kabmo CA>`. Benefits:

- unpaired devices are refused at the handshake, before any route;
- revocation is a row deletion (plus, optionally, a CRL / CA rotation);
- it composes with the existing cookie auth instead of replacing it.

Per-shell work: presenting a client certificate from a webview is
platform-specific (Android `onReceivedClientCertRequest` + KeyChain; iOS
`URLAuthenticationChallenge` with an identity; WebView2
`ClientCertificateRequested`; WebKitGTK `WebKitWebView::authenticate`). **Each
of those needs its own verification before this tier is promised** — none was
exercised here.

### Tier 3 — native E2E proxy (only if a hostile middle is in scope)

For the cases Tier 1 cannot cover (Android's error-path-only pinning; a tunnel
operator terminating TLS; a device with a compromised root store): the shell
runs a **local** reverse proxy on loopback and points the webview at it. The
proxy speaks a pinned, mutually authenticated channel to the server — TLS with
pinning, or HPKE/Noise (`X25519 + HKDF + AES-GCM`, all measured above at
16–30 µs per handshake primitive) — and serves plain `http://127.0.0.1:<port>`
to the webview. This restores `isSecureContext` (loopback is trustworthy), which
also brings back `getUserMedia`, clipboard and service workers.

Cost: a network stack in each shell, a COBS/framing/streaming implementation, and
a second place that must be kept in sync with the server's API surface. That is
a platform project, not a feature.

---

## 8. Security analysis

Assets: the UI password, the session cookie, agent transcripts (source code,
prompts, tool output), terminal bytes, file contents read/written by the tools,
dictation audio, and the ability to run tools on the host.

| Adversary | Today (http) | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| Passive sniffer on the Wi-Fi | full read | blocked | blocked | blocked |
| Active LAN MITM (ARP/DNS), no trusted cert | full control | blocked (pin) | blocked | blocked |
| MITM with a cert from an installed root | full control | **iOS/macOS/Windows/Linux: blocked; Android: not covered** | handshake succeeds (relay) — passive read still possible | blocked |
| Malicious tunnel operator (cloudflared) | full read | blocked by TLS only if the tunnel does not terminate it — it does; **not covered** | not covered | blocked |
| Stolen/unlocked device | full access | full access | revocation by deleting the device row | revocation |
| Compromised server process | full access | full access | full access | full access (it is the endpoint) |
| Cross-site page in the browser | blocked by `SameSite=Lax` + same-origin WS check | same | same | same |

Notes that follow from the code:

- With TLS, `sessionCookieHeader` adds `Secure` automatically
  (`isSecureRequest`) — no extra change needed.
- `isSameOriginUpgrade` returns `true` when `Origin` is absent. That is intended
  for non-browser clients, but it means the WS origin check is **not**
  authentication. Over plain HTTP a LAN attacker reads the cookie off the wire
  and connects regardless; TLS is what makes that check meaningful.
- A password change already revokes every session (the token embeds a
  fingerprint derived from the password). Device pins and mTLS certificates do
  **not** die with a password change — revocation needs its own path (Tier 2's
  device row, or rotating the Kabmo CA).
- Pinning is per `(origin, fingerprint)`. Changing the port, switching between
  `http` and `https`, or moving the server to another address invalidates the
  pair and must prompt a re-pair, not fail silently.

---

## 9. Open questions

1. **Android pinning under a trusted MITM root** — accept the gap (Tier 1 only),
   or fund Tier 3? This is the decision that sets the project's size.
2. **Client certificates in each webview** — must be verified per platform
   before Tier 2 is promised (none was exercised here).
3. **Certificate regeneration policy** — today the pair is reused forever, so a
   pin is stable. Any future rotation needs a re-pair flow or the shells brick.
4. **Compression is the bigger lever than encryption** — enabling
   `perMessageDeflate` (or zstd) on the realtime socket is a separate, cheaper
   change with a measured 6.5–10.5× wire reduction on chat frames (§6.6). The
   terminal socket was not measured for ratio; its frames are small (a 64 B PTY
   echo runs at 62 MB/s) and compression there needs its own benchmark.
5. **QR scope** — pairing a *phone* is the ask; pairing a *desktop shell* is the
   same payload, and the desktop shells already store a URL, so the marginal
   cost is one scanner-free "paste the code" path.

---

## 10. Verification log

All scripts lived in `/tmp/kabmo-e2e-bench` (throwaway, not in the repo) and ran
under Bun 1.4.3 on this machine. The live-server probes were started with
`KABMO_DATA_DIR` **and** `KABMO_DB_PATH` pointed at a temp directory.

| Claim | How |
|---|---|
| HTTP/HTTPS bulk, upload, CPU per GiB | `Bun.serve` + `fetch`, 64 MiB / 256 MiB payloads, 4–6 iterations, median |
| WS/WSS latency, bulk, per-frame bytes | `Bun.serve` websocket echo; a `node:net` TCP meter for byte counts |
| Handshake cost, concurrency, RSA vs P-256 | fresh `Connection: close` requests; self-signed certs generated with `openssl` |
| WebCrypto / pure-JS crypto | `crypto.subtle` and `@noble/curves`, `@noble/ciphers` under Bun |
| Secure-context loss on a LAN origin | Playwright Chromium, Pixel 7 profile, `http://127.0.0.1` vs `http://<lan-ip>` |
| Stream size | 2217 modelled `message_update` frames, gzip/zstd per frame |
| Real channel | live Kabmo `--tls` instance, login → `wss://…/api/realtime/ws`, app ping/resync |
| No ws compression | `ws.extensions` on a live socket → `""` |
| mTLS | local CA + server/client certs, `requestCert: true`, plain fetch and WebSocket |
| QR | `qrcode` encode, `jsQR` decode of a 1280×720 frame in Chromium |

Known side effect to disclose: one probe instance was started **without**
`KABMO_DB_PATH`, so it opened the repository's own `workspace.db` (MOCK mode)
and left a WAL entry. The file itself is gitignored and unmodified; nothing was
deleted.