/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Page zoom's arithmetic and its storage key.
 *
 * Both fail silently in the app: a clamp that lets 0.1 through makes the console
 * illegible with no way back except ⌘0, and a key that ignores the port makes a
 * zoom set on one server follow the user to another.
 */

import CoreGraphics

import KabmoDesktop

func zoomStoreCases() {
  group("page zoom")

  check("the default is 100%", ZoomStore.defaultZoom == 1)
  check("a value below the floor is clamped", ZoomStore.clamp(0.1) == ZoomStore.minZoom)
  check("a value above the ceiling is clamped", ZoomStore.clamp(9) == ZoomStore.maxZoom)
  check("NaN is not a zoom level", ZoomStore.clamp(.nan) == ZoomStore.defaultZoom)
  check("infinity is not a zoom level", ZoomStore.clamp(.infinity) == ZoomStore.defaultZoom)

  check("a step in grows the page", ZoomStore.zoomedIn(1) > 1)
  check("a step out shrinks the page", ZoomStore.zoomedOut(1) < 1)
  check("a step in stops at the ceiling", ZoomStore.zoomedIn(ZoomStore.maxZoom) == ZoomStore.maxZoom)
  check("a step out stops at the floor", ZoomStore.zoomedOut(ZoomStore.minZoom) == ZoomStore.minZoom)

  check("the key is per host", ZoomStore.key(forHost: "127.0.0.1:3000") == "zoom.127.0.0.1:3000")
  check("the key is case-folded", ZoomStore.key(forHost: "Console.Test") == "zoom.console.test")
  check("the key trims whitespace", ZoomStore.key(forHost: "  host  ") == "zoom.host")

  check("a host with a port keeps it", ZoomStore.host(of: "http://127.0.0.1:3000/chat") == "127.0.0.1:3000")
  check("a host without a port is the host", ZoomStore.host(of: "https://console.test/") == "console.test")
  check("no URL has no host", ZoomStore.host(of: nil) == nil)
  check("an empty URL has no host", ZoomStore.host(of: "") == nil)
  check("an unparseable URL has no host", ZoomStore.host(of: "not a url") == nil)
}
