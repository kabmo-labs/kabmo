import './styles.css';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import { usePanelInfo, useSessionValue } from '@kabmo-labs/kabmo-ui';
import { Field, FieldList, Note, Panel, TextAreaField } from '@kabmo-labs/kabmo-ui/components';

/**
 * The bundled example plugin.
 *
 * One file, one bundle, three slots — which is the whole shape of a panel
 * plugin: a `definePluginApp` default export whose `setup` registers the
 * components, and nothing else. The components run in Kabmo's own tree,
 * so they use Kabmo's theme classes and its hooks directly.
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
 *   demonstrates the two rules that come with it: the script appends into the
 *   ROOT element the context hands it (that element is what the plugin's own
 *   CSS is scoped to), and it gives its DOM back through the disposer.
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
 * Kept short on purpose: Kabmo caps it and gives it its own scroll, but a
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
 * The context hands over a ROOT element, and that is where this script's DOM
 * goes. The element carries this plugin's scope attribute, which is what the
 * imported stylesheet is scoped to — a node appended to `document.body`
 * instead would sit outside the surface and its own CSS could not reach it.
 *
 * The disposer releases what the host cannot. The DOM here needs no undoing —
 * the host removes the whole root subtree on teardown — but a script that
 * registered a listener or a timer has no other place to release it, and that
 * is what the returned function is for.
 */
function mountShellDecoration(context: { pluginId: string; root: HTMLElement }): () => void {
  const badge = context.root.ownerDocument.createElement('span');
  badge.className = 'session-info-badge';
  badge.textContent = 'session info active';
  context.root.appendChild(badge);

  return () => {
    badge.remove();
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
