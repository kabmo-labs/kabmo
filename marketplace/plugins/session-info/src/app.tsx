import './styles.css';
import { definePluginApp } from '@ompchamber/plugin-sdk/app';
import { usePanelInfo, useSessionValue } from '@ompchamber/ui';
import { Field, FieldList, Note, Panel, TextAreaField } from '@ompchamber/ui/components';

/**
 * The bundled example plugin.
 *
 * One file, one bundle, three slots — which is the whole shape of a panel
 * plugin: a `definePluginApp` default export whose `setup` registers the
 * components, and nothing else. The components run in the chamber's own tree,
 * so they use the chamber's theme classes and its hooks directly.
 *
 * It exists to exercise every surface a plugin can occupy, so a change that
 * breaks one slot is visible without writing a plugin:
 *
 * - `rightPanel` — a view in the right panel's activity bar.
 * - `headerPanel` — a navbar entry: a text readout that opens a dropdown.
 * - `panel` — the editor column, taken over whole. It is NOT an editor: the
 *   host supplies no tabs and no file tree, so a plugin that wants those builds
 *   them itself.
 * - `contentScript` + an imported stylesheet — the app-shell half. This is the
 *   only contribution that touches DOM the host did not hand it, so it also
 *   demonstrates the two rules that come with it: the script gives its DOM back
 *   through the disposer, and the CSS is scoped under the attribute it sets so
 *   it cannot leak onto the host's chrome.
 */

/** The status line, from the same save state the field reports. */
function noteHint(status: string, error: string | null, sessionId: string | null): string {
  if (error) return `Could not save: ${error}`;
  if (status === 'saved') return 'Saved.';
  if (status === 'saving') return 'Saving…';
  return sessionId ? `Session ${sessionId.slice(0, 8)}…` : 'No session selected.';
}

function SessionInfoPanel() {
  const info = usePanelInfo();
  const note = useSessionValue('note');

  return (
    <Panel title="Session Info">
      <FieldList>
        <Field label="workspace" value={info.workspacePath ?? 'none'} />
        <Field label="session" value={info.sessionId ?? 'none'} />
        <Field label="theme" value={info.theme} />
      </FieldList>
      <div className="mt-3">
        <TextAreaField
          id="session-info-note"
          label="note (saved per session)"
          value={note.value ?? ''}
          placeholder="Anything you want to keep for this session…"
          hint={noteHint(note.status, note.error, info.sessionId)}
          onInput={note.update}
        />
      </div>
    </Panel>
  );
}

/**
 * The navbar TRIGGER.
 *
 * A header entry is two components, and this is the one the user reads: plain
 * text, styled by the plugin, sitting in the navbar. It is deliberately not a
 * button — the host wraps it in one only when the registration also declares a
 * dropdown, so this component never has to know which case it is in.
 */
function SessionStatsTrigger() {
  const info = usePanelInfo();
  const note = useSessionValue('note');
  const length = (note.value ?? '').length;

  return (
    <span className="flex items-center gap-1.5 text-[11px] font-mono text-ink/70">
      <span>{info.sessionId ? `s${info.sessionId.slice(0, 4)}` : 'no session'}</span>
      <span className="text-ink/30">·</span>
      <span>{length} ch</span>
    </span>
  );
}

/**
 * The navbar DROPDOWN — drawn only while the entry is open.
 *
 * Kept short on purpose: the chamber caps it and gives it its own scroll, but a
 * readout nobody can take in at a glance defeats the point of a navbar entry.
 */
function SessionStatsDropdown() {
  const info = usePanelInfo();
  const note = useSessionValue('note');

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-ink">Session Stats</div>
      <FieldList>
        <Field label="workspace" value={info.workspacePath ?? 'none'} />
        <Field label="note length" value={String((note.value ?? '').length)} />
      </FieldList>
      <Note>{info.sessionId ? 'Attached to a session.' : 'No session selected yet.'}</Note>
    </div>
  );
}

/**
 * The `panel` slot: the editor COLUMN, taken over whole.
 *
 * Nothing about this is an editor — it is a second place a view can live, and
 * this one happens to be a scratchpad. A plugin that wanted tabs, a file list or
 * a split would build them here; the host contributes none of it.
 */
function ScratchpadPanel() {
  const info = usePanelInfo();
  const scratch = useSessionValue('scratch');

  return (
    <Panel title="Scratchpad">
      <TextAreaField
        id="scratchpad"
        label="scratch (saved per session, separate from the note)"
        value={scratch.value ?? ''}
        placeholder="Rough notes for this session…"
        hint={noteHint(scratch.status, scratch.error, info.sessionId)}
        onInput={scratch.update}
      />
    </Panel>
  );
}

/**
 * The `contentScript` slot, plus the stylesheet its import produces.
 *
 * The attribute on `<html>` is what the imported CSS scopes under, and the
 * disposer removes BOTH — a content script that leaves its attribute behind
 * would keep its rules matching after it was unloaded.
 */
function mountShellDecoration(context: { pluginId: string; generation: number }): () => void {
  document.documentElement.setAttribute('data-session-info', String(context.generation));
  return () => {
    document.documentElement.removeAttribute('data-session-info');
  };
}

export default definePluginApp((app) => {
  app.contentScript({ id: 'shell-decoration', mount: mountShellDecoration });
  app.rightPanel({
    id: 'info',
    title: 'Session Info',
    component: SessionInfoPanel,
    minWidth: 300,
    defaultFraction: 0.35,
  });
  // A trigger and a dropdown are separate components: the navbar reads the
  // first, and the second is what opening it shows. Declaring no dropdown would
  // make this a static readout with no interaction at all.
  app.headerPanel({
    id: 'stats',
    title: 'Session Stats',
    component: SessionStatsTrigger,
    dropdown: { component: SessionStatsDropdown },
  });
  app.panel({ id: 'scratch', title: 'Scratchpad', component: ScratchpadPanel });
});
