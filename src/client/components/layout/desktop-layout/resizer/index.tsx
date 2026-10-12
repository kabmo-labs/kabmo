import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'preact/compat';
import { useRef as useRefBase } from 'preact/hooks';
import type { ComponentChildren, RefObject } from 'preact';
import type { CSSProperties } from 'preact';
import { clamp, toPx } from '@/client/components/layout/desktop-layout/resizer/utils';
import { useSeparatorDrag } from '@/client/components/layout/desktop-layout/resizer/separator-drag';

/**
 * Hand-rolled resizable panel group (the Preact-native replacement for
 * react-resizable-panels in this app's two horizontal layouts).
 *
 * Model: every Panel is a flex child sized by `flex: 0 1 auto` plus a px
 * width/height held in state; exactly one panel per group is the FILLER
 * (`filler` prop) and takes `flex: 1 1 0`, absorbing the remaining space. A
 * Separator drag transfers pixels between the two panels adjacent to it,
 * clamped by both neighbors' min/max constraints, and commits once per drag
 * through `onLayoutChanged(_, { isUserInteraction: true })`.
 *
 * Sizes are pixels here. A caller that stores a width as a share of the group's
 * area (see `panel-widths.ts`) resolves it to px before passing it in — the
 * resizer has no percentage path and should not grow one.
 *
 * The filler's `minSize` is a real CSS floor, which is what makes a shrinking
 * window push the resizable panels toward their own floors instead of
 * collapsing the filler to nothing (a zero flex basis absorbs no negative free
 * space). Once every panel sits at its floor the row is narrower than its
 * container and the surplus is clipped — the layout has no panel to give up.
 *
 * The imperative API mirrors what this app used from the old library:
 * `panelRef.resize(px)`, `panelRef.getSize() -> { inPixels }`, and the
 * group's `setLayout` as a batch px resize.
 */

export type GroupOrientation = 'horizontal' | 'vertical';

export interface LayoutMeta {
  isUserInteraction: boolean;
}

export interface PanelImperativeHandle {
  /** Set this panel's size in pixels (clamped to its min/max). */
  resize: (px: number) => void;
  /** Current rendered size in pixels, or null while unmounted. */
  getSize: () => { inPixels: number } | null;
}

export type LayoutChangedHandler = (layout: Record<string, number>, meta: LayoutMeta) => void;

export interface PanelState {
  id: string;
  isFiller: boolean;
  minSize: number;
  maxSize: number;
  /** Push a new px size into the owning Panel's state (declarative render). */
  setSize: (px: number) => void;
  /** Latest committed px size; null for the filler. */
  getSize: () => number | null;
}

interface GroupContextValue {
  orientation: GroupOrientation;
  panels: { current: Map<string, PanelState> };
  /** Latest group-level layout callback, kept fresh for drag commits. */
  onLayoutChanged: { current: LayoutChangedHandler | null };
}

const GroupContext = createContext<GroupContextValue | null>(null);

export function Group(props: {
  orientation: GroupOrientation;
  id?: string;
  /** The group's own element, for measuring the area its panels share. */
  groupRef?: RefObject<HTMLDivElement>;
  onLayoutChanged?: LayoutChangedHandler;
  className?: string;
  children: ComponentChildren;
}) {
  const { orientation, id, groupRef, onLayoutChanged, className, children } = props;
  const panelsRef = useRefBase<Map<string, PanelState>>(new Map());
  // Latest callback without re-subscribing anything: separators and the
  // imperative handle read it through a ref.
  const changedRef = useRefBase<LayoutChangedHandler | null>(onLayoutChanged ?? null);
  changedRef.current = onLayoutChanged ?? null;

  const ctx = useMemo<GroupContextValue>(
    () => ({ orientation, panels: panelsRef, onLayoutChanged: changedRef }),
    [orientation],
  );

  return (
    <GroupContext.Provider value={ctx}>
      <div
        ref={groupRef}
        data-panel-group=""
        data-panel-group-id={id}
        className={className}
        style={{ display: 'flex', flex: '1 1 0%', flexDirection: orientation === 'horizontal' ? 'row' : 'column', minWidth: 0, minHeight: 0 } as CSSProperties}
      >
        {children}
      </div>
    </GroupContext.Provider>
  );
}

export function Panel(props: {
  id: string;
  panelRef?: RefObject<PanelImperativeHandle | null>;
  /** Initial size in px; ignored for the filler panel. */
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
  /**
   * Render at zero width without unmounting. The panel keeps its size state, so
   * reopening restores the remembered width and the width transition animates
   * the movement instead of the content popping in.
   */
  collapsed?: boolean;
  /** This panel absorbs the remaining space instead of holding its own px. */
  filler?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ComponentChildren;
}) {
  const { id, panelRef, defaultSize, minSize = 0, maxSize, collapsed = false, filler = false, className, style, children } = props;
  const group = useContext(GroupContext);
  if (!group) {
    throw new Error(`<Panel id="${id}"> must be rendered inside a <Group>`);
  }
  const { orientation, panels } = group;

  const minPx = toPx(minSize, 0);
  const maxPx = maxSize != null ? toPx(maxSize, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [sizePx, setSizePx] = useState<number | null>(() =>
    filler ? null : clamp(toPx(defaultSize, minPx), minPx, maxPx),
  );
  const sizePxRef = useRef(sizePx);

  /**
   * The ONE way a size is applied: the ref and the state move together.
   *
   * A separator drag commits in the same tick it lands its final size —
   * `useSeparatorDrag`'s `onUp` calls `apply()` and then reads every panel's
   * `getSize()` to build the layout it reports. Writing only the state leaves the
   * ref holding the size from the LAST render, so the commit persisted the width
   * the panel had BEFORE the drag (measured: a sidebar dragged 351 → 446 posted
   * `omp_sidebar_width: 351`), and the drag looked like it never saved.
   */
  const applySize = (px: number) => {
    sizePxRef.current = px;
    setSizePx(px);
  };

  // Register with the group so separators and the imperative handle can find
  // this panel. Runs once per mount.
  useEffect(() => {
    const state: PanelState = {
      id,
      isFiller: filler,
      minSize: minPx,
      maxSize: maxPx,
      setSize: applySize,
      getSize: () => sizePxRef.current,
    };
    panels.current.set(id, state);
    return () => {
      panels.current.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Constraints can change between renders (e.g. the right panel's min per
  // view); refresh the registry entry every render.
  useEffect(() => {
    const state = panels.current.get(id);
    if (state) {
      state.minSize = minPx;
      state.maxSize = maxPx;
    }
  });

  // Adopt a changed `defaultSize`. This is what restores a panel after its
  // owner swaps it — a right-panel view switch, an editor source↔diff switch —
  // and after a resize recomputes it, without an imperative push from the
  // owner. A drag does not fight it: the owner only produces a new
  // `defaultSize` once the drag commits, and that value is the size the drag
  // already applied.
  const lastDefaultPxRef = useRef<number | null>(null);
  useEffect(() => {
    if (filler || defaultSize == null) return;
    const nextPx = toPx(defaultSize, minPx);
    if (lastDefaultPxRef.current === nextPx) return;
    lastDefaultPxRef.current = nextPx;
    applySize(clamp(nextPx, minPx, maxPx));
  }, [defaultSize, filler, minPx, maxPx]);

  useEffect(() => {
    if (!panelRef) return;
    panelRef.current = {
      resize: (px) => {
        applySize(clamp(px, minPx, maxPx));
      },
      getSize: () => {
        const px = sizePxRef.current;
        return px != null ? { inPixels: px } : null;
      },
    };
    return () => {
      panelRef.current = null;
    };
  }, [panelRef, minPx, maxPx]);

  const baseStyle: CSSProperties = filler
    ? {
        flex: '1 1 0%',
        // The filler keeps its floor on the group's axis (and none across it,
        // where it is sized by the container): see the group model note above.
        minWidth: orientation === 'horizontal' ? minPx : 0,
        minHeight: orientation === 'horizontal' ? 0 : minPx,
        overflow: 'hidden',
        position: 'relative',
      }
    : {
        flex: '0 1 auto',
        width: orientation === 'horizontal' ? (collapsed ? 0 : sizePx ?? undefined) : undefined,
        height: orientation === 'horizontal' ? undefined : collapsed ? 0 : sizePx ?? undefined,
        minWidth: orientation === 'horizontal' ? (collapsed ? 0 : minPx) : undefined,
        minHeight: orientation === 'horizontal' ? undefined : collapsed ? 0 : minPx,
        maxWidth: maxSize != null ? maxPx : undefined,
        // A drag re-applies the real width at most every RESIZE_FOLLOW_INTERVAL_MS
        // (see useSeparatorDrag), and this transition is what makes those steps
        // read as one movement. It also carries a panel to its remembered width
        // on a view switch, and to zero on collapse, instead of snapping.
        transition: `${orientation === 'horizontal' ? 'width' : 'height'} 200ms cubic-bezier(0.22, 1, 0.36, 1)`,
        overflow: 'hidden',
        position: 'relative',
      };

  return (
    <div
      ref={elementRef}
      data-panel=""
      data-panel-id={id}
      data-panel-collapsed={collapsed ? '' : undefined}
      className={className}
      style={{ ...baseStyle, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * The drag handle between two panels. Dragging transfers pixels from the
 * previous sibling panel to the next sibling panel, clamped by both sides,
 * and commits one `onLayoutChanged(_, { isUserInteraction: true })` per drag.
 *
 * While a drag is active, a fixed overlay blocks pointer capture — most
 * importantly the browser panel's iframe, which would otherwise swallow
 * pointermove events mid-drag.
 */
export function Separator(props: { className?: string; style?: CSSProperties; children?: ComponentChildren }) {
  const { className, style, children } = props;
  const group = useContext(GroupContext);
  const hostRef = useRef<HTMLDivElement | null>(null);

  if (!group) {
    throw new Error('<Separator> must be rendered inside a <Group>');
  }
  const { orientation, panels, onLayoutChanged } = group;
  const { dragging, guidePx, onPointerDown } = useSeparatorDrag(hostRef, orientation, panels, onLayoutChanged);

  return (
    <div
      ref={hostRef}
      data-separator=""
      role="separator"
      aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
      className={className}
      style={style}
      onPointerDown={onPointerDown}
      onDragStart={(e: DragEvent) => e.preventDefault()}
    >
      {children}
      {dragging && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            cursor: orientation === 'horizontal' ? 'col-resize' : 'row-resize',
          } as CSSProperties}
        />
      )}
      {guidePx !== null && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            ...(orientation === 'horizontal'
              ? { left: `${guidePx}px`, top: 0, bottom: 0, width: '1px' }
              : { top: `${guidePx}px`, left: 0, right: 0, height: '1px' }),
            zIndex: 9998,
            pointerEvents: 'none',
            background: 'var(--theme-ink)',
            opacity: 0.35,
          } as CSSProperties}
        />
      )}
    </div>
  );
}