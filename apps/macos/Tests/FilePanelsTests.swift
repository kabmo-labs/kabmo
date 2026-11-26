/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The file panel's decisions, pinned without a window server.

 Every case here fails SILENTLY in the app, which is how the bug shipped: a
 `WKWebView` with no `uiDelegate` answers a file-input click as Cancel, and a
 panel built from the wrong answer either offers files the control refuses or
 refuses the one it needs.

 The filter comes from the element's `accept`, because `WKOpenPanelParameters`
 carries only two booleans (verified against the macOS 27 SDK). It is read from
 the page on a capture click, so the store is part of the contract too: a value
 left behind would filter the NEXT panel with the PREVIOUS control's types.
 */
import Foundation
import UniformTypeIdentifiers

import KabmoDesktop

func filePanelCases() {
  group("UploadPrompt — what the panel may offer")

  let image = UploadPrompt.forElement(
    allowsMultipleSelection: false,
    allowsDirectories: false,
    accept: "image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
  )
  check("an image control offers exactly those types", image.contentTypes.count == 5)
  check("and is a single-file panel", image.allowsMultiple == false)
  check("an all-image control is titled as one", image.title == "Choose an image")
  check("a file control is not a directory picker", image.allowsDirectories == false)

  let attach = UploadPrompt.forElement(
    allowsMultipleSelection: true,
    allowsDirectories: false,
    accept: nil
  )
  check("the composer's attach input asks for several files", attach.allowsMultiple)
  check("with no accept the panel offers any file", attach.contentTypes.isEmpty)
  check("and says so rather than claiming images", attach.title == "Choose a file")

  let extensions = UploadPrompt.forElement(
    allowsMultipleSelection: false,
    allowsDirectories: false,
    accept: ".png,.svg"
  )
  check("extensions resolve to types", extensions.contentTypes == [.png, .svg])

  let wildcard = UploadPrompt.forElement(
    allowsMultipleSelection: false,
    allowsDirectories: false,
    accept: "image/*"
  )
  check("a wildcard resolves to the MIME supertype", wildcard.contentTypes == [.image])

  let mixed = UploadPrompt.forElement(
    allowsMultipleSelection: false,
    allowsDirectories: false,
    accept: "image/png,application/pdf"
  )
  check("a mixed control keeps both", mixed.contentTypes == [.png, .pdf])
  check("a mixed control is not titled as an image", mixed.title == "Choose a file")

  check(
    "junk in accept is dropped, not turned into a filter",
    uploadContentTypes(fromAccept: "not-a-type, ,image/png").count == 1
  )
  check("an empty accept means no filter", uploadContentTypes(fromAccept: "   ").isEmpty)
  check(
    "duplicate entries collapse",
    uploadContentTypes(fromAccept: "image/png,image/png").count == 1
  )

  group("UploadAcceptStore — one click, one panel")

  let store = UploadAcceptStore()
  check("nothing recorded answers nil", store.take() == nil)
  store.record("image/png")
  check("a recorded value is read back", store.take() == "image/png")
  check("and consumed, so the next panel is not filtered by it", store.take() == nil)

  store.record(nil)
  check("a file input with no accept clears the filter", store.take() == nil)
}
