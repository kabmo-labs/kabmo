/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// The window's arithmetic — edges, zoom, geometry, and the double-click preference.
// 
// Pure functions only: the GTK calls they feed are verified under a window
// manager, which this suite deliberately does not need.

use kabmo_desktop::window::{
    cursor_for, edge_at, zoom_target, DoubleClickAction, Geometry, DEFAULT_HEIGHT, DEFAULT_WIDTH,
    MAX_ZOOM, MIN_HEIGHT, MIN_WIDTH, MIN_ZOOM, ZOOM_STEP,
};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("window edges");
    r.check(
        "the top-left corner resizes both axes",
        edge_at(2.0, 2.0, 800.0, 600.0) == Some(gtk::gdk::WindowEdge::NorthWest),
    );
    r.check(
        "the bottom-right corner resizes both axes",
        edge_at(799.0, 599.0, 800.0, 600.0) == Some(gtk::gdk::WindowEdge::SouthEast),
    );
    r.check(
        "a mid-height press on the west edge resizes one axis",
        edge_at(2.0, 300.0, 800.0, 600.0) == Some(gtk::gdk::WindowEdge::West),
    );
    r.check(
        "a press in the middle belongs to the page",
        edge_at(400.0, 300.0, 800.0, 600.0).is_none(),
    );
    r.check(
        "a zero-sized window has no edges",
        edge_at(0.0, 0.0, 0.0, 0.0).is_none(),
    );
    r.check(
        "the cursor advertises the corner it will grab",
        cursor_for(2.0, 2.0, 800.0, 600.0) == "nw-resize",
    );
    r.check(
        "the cursor is the plain one away from every edge",
        cursor_for(400.0, 300.0, 800.0, 600.0) == "default",
    );

    r.group("page zoom");
    // The menu and the shortcuts walk the same ladder, so this is the one place
    // its ends are checked. A step that could pass the bound would leave a zoom
    // the other entry point refuses to reach.
    r.check(
        "a step from 100% grows by the shared factor",
        (zoom_target(1.0, ZOOM_STEP) - ZOOM_STEP).abs() < 1e-9,
    );
    r.check(
        "zooming in stops at the ceiling",
        (zoom_target(MAX_ZOOM, ZOOM_STEP) - MAX_ZOOM).abs() < 1e-9,
    );
    r.check(
        "zooming out stops at the floor",
        (zoom_target(MIN_ZOOM, 1.0 / ZOOM_STEP) - MIN_ZOOM).abs() < 1e-9,
    );
    r.check(
        "a step in and back out returns to where it started",
        (zoom_target(zoom_target(1.0, ZOOM_STEP), 1.0 / ZOOM_STEP) - 1.0).abs() < 1e-9,
    );

    r.group("window geometry");
    // The macOS shell remembers the frame (`setFrameAutosaveName`); GTK has no
    // equivalent, so the file is the whole mechanism and a bad parse must not
    // produce an unusable window.
    let parsed = Geometry::parse("x=120\ny=60\nwidth=1400\nheight=900\n");
    r.check(
        "a written geometry reads back",
        parsed == (Geometry { x: 120, y: 60, width: 1400, height: 900 }),
    );
    r.check(
        "a size-only file keeps the size and records no position",
        Geometry::parse("width=1000\nheight=700\n").has_position() == false
            && Geometry::parse("width=1000\nheight=700\n").width == 1000,
    );
    r.check(
        "a missing file is the default size",
        Geometry::parse("").width == DEFAULT_WIDTH && Geometry::parse("").height == DEFAULT_HEIGHT,
    );
    // A window smaller than the floor cannot be resized by a keyboard, and one
    // restored off-screen can only be recovered by editing the file.
    r.check(
        "a tiny stored size is clamped to the floor",
        Geometry::parse("width=10\nheight=10\n").width == MIN_WIDTH
            && Geometry::parse("width=10\nheight=10\n").height == MIN_HEIGHT,
    );
    r.check(
        "nonsense values fall back per field",
        Geometry::parse("width=wide\nheight=700\n").width == DEFAULT_WIDTH
            && Geometry::parse("width=wide\nheight=700\n").height == 700,
    );
    r.check(
        "the serialised form round-trips",
        Geometry::parse(&parsed.serialise()) == parsed,
    );

    r.group("double-click preference");
    r.check(
        "unset is GTK's own toggle",
        DoubleClickAction::from_preference(None) == DoubleClickAction::ToggleMaximize,
    );
    r.check(
        "'minimize' is read case-insensitively",
        DoubleClickAction::from_preference(Some("Minimize")) == DoubleClickAction::Minimize,
    );
    r.check(
        "'maximize' does not toggle",
        DoubleClickAction::from_preference(Some("maximize")) == DoubleClickAction::Maximize,
    );
    r.check(
        "an unknown value falls back to the default",
        DoubleClickAction::from_preference(Some("something-else"))
            == DoubleClickAction::ToggleMaximize,
    );
}
