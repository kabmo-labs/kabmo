/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The file open panel behind every `<input type="file">` in the console.
 *
 * ## The bug this exists for
 *
 * A `WKWebView` with NO `WKUIDelegate` does not fall back to a system panel —
 * WebKit's own header says so: "If you do not implement this method on macOS,
 * the web view will behave as if the user selected the Cancel button." The shell
 * implemented `WKNavigationDelegate` and never set `uiDelegate` at all, so every
 * file input in the app was silently cancelled: the composer's attach button and
 * the project icon's "Upload image". Nothing threw, nothing logged, and the click
 * did nothing — which is exactly what "tombol upload tidak berfungsi" looks like
 * from the outside. The same click works in a browser tab, which is why it
 * survived.
 *
 * ## The rules
 *
 * - **`NSOpenPanel` as a SHEET on the window.** A free-standing dialog can end
 *   up behind the window with the page blocked waiting for an answer.
 * - **`allowsMultipleSelection` / `allowsDirectories` come from `parameters`** —
 *   WebKit's report of the ELEMENT. The composer's attach input is `multiple`
 *   and the icon input is not; one panel configuration for both returns
 *   selections the single-file control then ignores.
 * - **The element's `accept` narrows the panel**, because `WKOpenPanelParameters`
 *   carries only the two booleans (verified against the macOS 27 SDK: no
 *   `accept` property). A control that only accepts images must not let the user
 *   pick a PDF and be refused afterwards.
 * - **Cancel answers `nil`**, the documented "user selected Cancel".
 *
 * ## How the `accept` reaches the panel
 *
 * WebKit does not tell the delegate which element opened the panel, and
 * `document.activeElement` cannot be read synchronously from the renderer. A
 * document-start user script therefore records the attribute into
 * `UploadAcceptStore` on a capture-phase click, and `runOpenPanel` reads that
 * store. An empty answer means "any file" — the panel is never blocked on it.
 *
 * The decisions are pure and pinned by the test suite; only `present` needs a
 * window server.
 */
import AppKit
import UniformTypeIdentifiers
import WebKit

/**
 The `accept` attribute, resolved to the file types it names.

 `accept` is a comma-separated list of extensions (`.png`), MIME types
 (`image/png`) or a wildcard (`image/<star>`). Each entry is resolved through
 `UTType(filenameExtension:)` or `UTType(mimeType:)`; anything unrecognised is
 dropped rather than turned into a filter the panel cannot enforce. An empty
 result means "no filter" — the honest answer for a control that named none.
 */
public func uploadContentTypes(fromAccept accept: String?) -> [UTType] {
  guard let accept, !accept.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }

  var types: [UTType] = []
  for raw in accept.split(separator: ",") {
    let token = raw.trimmingCharacters(in: .whitespaces).lowercased()
    guard !token.isEmpty else { continue }

    let resolved: UTType?
    if token.hasPrefix(".") {
      resolved = concreteType(filenameExtension: String(token.dropFirst()))
    } else if token.hasSuffix("/" + "*") {
      // `image/<star>` names a FAMILY, and `UTType(mimeType:)` happily invents a
      // dynamic type for it ("dyn.ah62…") that matches nothing on disk. The
      // family's own supertype is what the panel can enforce.
      resolved = familyTypes[String(token.dropLast(2))]
    } else if token.contains("/") {
      resolved = concreteType(mimeType: token)
    } else {
      resolved = concreteType(filenameExtension: token)
    }

    if let resolved, !types.contains(resolved) { types.append(resolved) }
  }
  return types
}

/**
 The supertype for a MIME family (`image` → `public.image`).
 
 Only families with a declared `UTType` are listed; a wildcard for anything else
 resolves to nothing, which leaves the panel unfiltered rather than filtered by a
 type the system invented.
 */
private let familyTypes: [String: UTType] = [
  "image": .image,
  "video": .movie,
  "audio": .audio,
  "text": .text,
  "font": .font,
  "model": .threeDContent,
]

/**
 A CONCRETE type, or nil.

 `UTType(filenameExtension:)` and `UTType(mimeType:)` both return a DYNAMIC type
 for anything they do not recognise — `not-a-type` became
 `dyn.ah62d4rv4ge80655yfzuw47d3sbwu` — and a dynamic type in `allowedContentTypes`
 filters the panel down to nothing. A dynamic answer is therefore "unknown", not
 "that type".
 */
private func concreteType(filenameExtension: String) -> UTType? {
  guard let type = UTType(filenameExtension: filenameExtension), !type.isDynamic else { return nil }
  return type
}

private func concreteType(mimeType: String) -> UTType? {
  guard let type = UTType(mimeType: mimeType), !type.isDynamic else { return nil }
  return type
}

/** What the panel is allowed to offer for one upload control. */
public struct UploadPrompt: Equatable {
  public let allowsMultiple: Bool
  public let allowsDirectories: Bool
  /** Empty means "any file". */
  public let contentTypes: [UTType]
  public let title: String

  public init(
    allowsMultiple: Bool,
    allowsDirectories: Bool = false,
    contentTypes: [UTType] = [],
    title: String = "Choose a file"
  ) {
    self.allowsMultiple = allowsMultiple
    self.allowsDirectories = allowsDirectories
    self.contentTypes = contentTypes
    self.title = title
  }

  /**
   The prompt for an element: WebKit's two booleans plus the recorded `accept`.

   A single-file image control is the case this was written for, and it is also
   the case a one-size-fits-all panel gets wrong — it would offer a PDF.
   */
  public static func forElement(
    allowsMultipleSelection: Bool,
    allowsDirectories: Bool,
    accept: String?
  ) -> UploadPrompt {
    let types = uploadContentTypes(fromAccept: accept)
    // Every type the control accepts is an image — the icon field's case. A
    // mixed list (images beside a PDF) is a file panel that happens to include
    // images, and calling it an image panel would misdescribe it.
    let imagesOnly = !types.isEmpty && types.allSatisfy { $0.conforms(to: .image) }
    return UploadPrompt(
      allowsMultiple: allowsMultipleSelection,
      allowsDirectories: allowsDirectories,
      contentTypes: types,
      title: imagesOnly ? "Choose an image" : "Choose a file"
    )
  }
}

/**
 The `accept` of the upload control that was last clicked.

 Written by the document-start script below and read in `runOpenPanel`, which
 WebKit calls with no element identity. A store rather than a closure on the
 delegate because the value crosses a renderer round trip: the click happens in
 the page, the panel request arrives on the main actor afterwards.
 */
public final class UploadAcceptStore {
  private var accept: String?

  public init() {}

  public func record(_ value: String?) {
    accept = value
  }

  /// The recorded value, consumed so a later non-file click cannot reuse it.
  public func take() -> String? {
    defer { accept = nil }
    return accept
  }
}

/** The user script that records a file control's `accept` on capture. */
public let uploadAcceptScript = """
(() => {
  if (window.__kabmoUploadAcceptInstalled) return;
  window.__kabmoUploadAcceptInstalled = true;
  const name = '__kabmoUploadAccept';
  document.addEventListener('click', (event) => {
    const target = event.target;
    const input = target && target.closest ? target.closest('input[type=file]') : null;
    if (!input) return;
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[name];
    if (handler) handler.postMessage(input.getAttribute('accept') || '');
  }, true);
})();
"""

/// The message name the script posts to.
public let uploadAcceptMessageName = "__kabmoUploadAccept"

/**
 Show the panel as a sheet and answer the selection.
 
 `completion` receives the chosen URLs, or `nil` for Cancel — the exact contract
 `runOpenPanelWithParameters` wants. Split from the delegate so the pure
 decisions above are testable without a window server.
 */
@MainActor
public func presentUploadPanel(
  _ prompt: UploadPrompt,
  on window: NSWindow?,
  completion: @escaping ([URL]?) -> Void
) {
  let panel = NSOpenPanel()
  panel.title = prompt.title
  panel.message = prompt.title
  panel.prompt = "Choose"
  panel.canChooseFiles = !prompt.allowsDirectories
  panel.canChooseDirectories = prompt.allowsDirectories
  panel.allowsMultipleSelection = prompt.allowsMultiple
  panel.resolvesAliases = true
  if !prompt.contentTypes.isEmpty {
    panel.allowedContentTypes = prompt.contentTypes
  }

  let answer: (NSApplication.ModalResponse) -> Void = { response in
    completion(response == .OK ? panel.urls : nil)
  }

  if let window {
    panel.beginSheetModal(for: window, completionHandler: answer)
  } else {
    // No window to attach to (a detached page, a test host): a free-standing
    // modal still answers, and a dead button is the bug this module fixes.
    answer(panel.runModal())
  }
}

/**
 The `WKUIDelegate` the shell installs: the file panel, and where a popup goes.

 Lives here rather than in `App.swift` so the window suite drives THIS object
 instead of a stand-in: a near-miss Swift signature still compiles (the method is
 optional on the protocol) and WebKit then keeps treating uploads as Cancel, so
 the class the app installs is the thing worth pressing.

 The popup half is here for the same reason — WebKit asks ONE delegate for both
 questions, and a web view with no `createWebViewWith` answers `window.open` and
 `<a target="_blank">` by doing nothing at all. Every external link in the console
 is written that way (release notes, the social rows, the provider OAuth page), so
 the click silently did nothing before this existed.
 */
@MainActor
public final class ShellUIDelegate: NSObject, WKUIDelegate {
  private let store: UploadAcceptStore
  private weak var window: NSWindow?
  /// Where a popup goes. Injected so a case can record the URL instead of
  /// launching Safari.
  private let openExternally: (URL) -> Void

  public init(
    store: UploadAcceptStore,
    window: NSWindow?,
    openExternally: @escaping (URL) -> Void = { NSWorkspace.shared.open($0) }
  ) {
    self.store = store
    self.window = window
    self.openExternally = openExternally
    super.init()
  }

  /// Point the panel at a different window (the app's window is built later).
  public func attach(to window: NSWindow?) {
    self.window = window
  }

  public func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let prompt = UploadPrompt.forElement(
      allowsMultipleSelection: parameters.allowsMultipleSelection,
      allowsDirectories: parameters.allowsDirectories,
      accept: store.take()
    )
    presentUploadPanel(prompt, on: window, completion: completionHandler)
  }

  /// `window.open(url, '_blank')` and `<a target="_blank">`.
  ///
  /// The URL goes to the system browser and `nil` is returned, because this shell
  /// owns exactly one window: a second chromeless web view would have no address
  /// bar and no way back. `NavigationPolicy` allows these through its own gate
  /// (`.newWindow`) rather than opening them itself, so one click opens one
  /// browser — measured in a real `WKWebView`: with an external open on BOTH
  /// paths, one click launched two tabs.
  public func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      openExternally(url)
    }
    return nil
  }
}
