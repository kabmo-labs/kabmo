/**
 * Live browser-viewer contract shared between the /api/browser route and the
 * browser panel. Values are produced server-side from the omp shared-browser
 * daemon (see app/lib/browser/) and consumed by the panel's screencast hook.
 */

/** Why the viewer is not showing frames, or that it is. */
export type BrowserViewStatus = 'agent-offline' | 'browser-offline' | 'no-tab' | 'live';

/** One page target living in the project-shared browser. */
export interface BrowserTabInfo {
  targetId: string;
  url: string;
  title: string;
}

/** Coarse viewer state pushed on every meaningful change. */
export interface BrowserViewState {
  status: BrowserViewStatus;
  url?: string;
  title?: string;
  targetId?: string;
  tabs: BrowserTabInfo[];
}

/** One screencast frame (base64 JPEG) for the currently viewed tab. */
export interface BrowserViewFrame {
  data: string;
  mimeType: string;
  targetId: string;
}

export type BrowserActionKind =
  | 'open'
  | 'navigate'
  | 'loaded'
  | 'click'
  | 'type'
  | 'press'
  | 'submit'
  | 'wait'
  | 'screenshot'
  | 'scroll'
  | 'upload'
  | 'close'
  | 'error';

export interface BrowserPanelAction {
  id: string;
  kind: BrowserActionKind;
  label: string;
}

/**
 * How the user marked a spot on the user-browser panel.
 *
 * The panel is a cross-origin iframe, so a mark can never carry PIXELS: the
 * page inside is unreadable to this origin (`contentDocument` is null,
 * `drawImage(iframe)` throws, and a capture would show the user's whole
 * screen). What travels is geometry plus words — the exact region, and what
 * the user says is wrong there.
 */
export type AnnotateTool = 'box' | 'pin' | 'arrow';

/** One point, normalized to the measured panel: 0..1 on both axes. */
export interface AnnotatePoint {
  x: number;
  y: number;
}

/**
 * What the marked spot IS, when the page allows reading it.
 *
 * Only a SAME-ORIGIN frame can be read (`contentDocument` is non-null); a real
 * dev server runs on its own port, which is a different origin even on the same
 * host — measured in Chromium: `:7101` reading `:7102` yields `contentDocument
 * === null`. So this is present only when the page was readable, and the prompt
 * says so when it is absent instead of pretending.
 */
export interface AnnotateElement {
  /** `section[aria-label="Ringkasan"] > button#pay`, at most 4 levels. */
  path: string;
  /** Lowercase tag name, e.g. `select`. */
  tag: string;
  /** Explicit `role`, when the element declares one. */
  role?: string;
  /** Visible text, whitespace-collapsed and cut short. */
  text?: string;
  /** `<select>` value and option count, `disabled`, and similar. */
  state?: string;
}

/**
 * One numbered mark. `box`/`arrow` use both points; `pin` uses `start`.
 *
 * `label` is the user's NAME for the region ("Ringkasan pesanan", "form
 * alamat"). It is not derived from the page: the label is the one fact a
 * cross-origin frame can never give us, and the user always has it.
 */
export interface AnnotateShape {
  id: string;
  tool: AnnotateTool;
  start: AnnotatePoint;
  end: AnnotatePoint;
  /** The user's name for the region; empty until they say it. */
  label: string;
  /** What the user says about this region; empty while they are still drawing. */
  note: string;
  /** The element under the mark, when the frame was same-origin and readable. */
  element?: AnnotateElement;
}

/**
 * The panel box the marks were drawn on, in CSS px.
 *
 * Percentages alone are not enough: `12% of a 1024px panel` and `12% of a
 * 375px panel` are different places, and the agent has to know which page
 * shape the user was looking at to reproduce the view.
 */
export interface AnnotatePanelSize {
  width: number;
  height: number;
  viewportMode: string;
  /** CSS zoom the panel was showing at (100 = none). */
  zoom: number;
}

/** Page context handed from a browser panel to the chat composer draft. */
export interface BrowserPageContext {
  url: string;
  title?: string;
  /** The marks the user made, in draw order. Absent when they only shared a page. */
  annotations?: AnnotateShape[];
  /** The box those marks were normalized against. Present whenever `annotations` is. */
  panel?: AnnotatePanelSize;
}
