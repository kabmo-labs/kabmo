# Plugin platform — wave 2: opening the agent surface

Wave 1 (`docs/plugin-platform-plan.md`, shipped in `8ea446f`) gave a plugin a
server half, storage, RPC, HTTP, a realtime topic, eight list slots, a test
harness and a CLI. What it did NOT give a plugin is the ability to **act on the
conversation**. A wave-1 plugin can draw into a slot and read per-session state;
it cannot read the composer's draft, drive a run, answer the agent's own
questions, or touch the app shell.

Measured against `get-bb/bb` @ `main`:

| Surface | bb | chamber after wave 1 |
|---|---|---|
| App-side members | 45 (`PluginSdkApp`) | 6 hooks + 9 components |
| Server-side members | 22 (`BbPluginApi`) | 8 |
| Contract lines | 5,643 | 749 |

The gap is not count. It is that bb's plugin is a **participant** — `useComposer`
(32 members) reads and writes the draft, `useSidebarThreadActions` drives
threads, `pendingInteraction` answers the agent, `contentScripts` owns app-shell
DOM — while ours is a **view**.

This plan closes that, in the order value-per-cost, and stops where the gap is
structural (bb's `providers`/`environments`/`machines` exist because bb ships its
own agent runtime; see D1 of the wave-1 plan — that decision stands).

Status: **W0–W6 shipped**; see the workstream table below for what each one
verified.

## Workstreams

| # | Workstream | Why it matters | Risk |
|---|---|---|---|
| W1 | Kit `useRpc`, `useRealtime`, `useComposer` | The three hooks that turn a plugin from a view into a participant. W1's server half is already there and unreachable without them. | low |
| W2 | `providerIcon` slot | The glyph table already exists (`provider-icon/glyphs.ts`); it is simply not opened to plugins. | low |
| W3 | `pendingInteraction` slot | Lets a plugin answer the agent's own questions — the one place a plugin can change what the agent DOES rather than what it looks like. | med |
| W4 | `messageDirective` slot | Gives a plugin a fenced block in the chat that renders as its own component. | med |
| W5 | `contentScripts` | Extends a plugin from "a slot" to "a page" — app-shell DOM without rendering a component. | med |
| W6 | Component registry | Deferred in wave 1 (P6). Re-evaluate now that the kit has grown. | — |

## W1 — The kit hooks

Three hooks, all in `packages/ui/src/`. The seam is the same one wave 1 built:
`configureUiKit` injects the host's services, and the kit reads them.

### `useRpc(method)`

Calls one of the plugin's OWN server methods, through the route wave 1 added.

```ts
const { call, pending, error } = useRpc<{ query: string }, Row[]>('list');
await call({ query: 'today' });
```

**It must not be `useChamberFetch` with a different URL.** Three behaviours the
fetch hook does not have and this one needs:

1. **The plugin id comes from the HOST**, injected as a service. A plugin that
   built its own URL would have to know its own id — which it can, but a plugin
   that got it wrong would call another plugin's method, and the host is the one
   party that cannot be wrong about it.
2. **A call is POST with a JSON body**, and the answer is `{ ok, value }` or
   `{ ok: false, error }` at HTTP 200 — so a plugin's own refusal must surface
   as `error` (the method's reason), NOT as a thrown network error. The
   distinction wave 1's route draws at the wire has to survive into the hook.
3. **`pending` is per-call, and a superseded call is dropped.** Two calls in
   flight must not leave the first one's value on screen.

### `useRealtime(payload?)`

Subscribes to the plugin's own `plugin:<id>` topic — the one `api.realtime.publish`
writes to.

```ts
const { value, stale, refresh } = useRealtime<{ count: number }>();
```

The host owns the topic name (same reasoning as `useRpc`), and the hook must
surface `stale` rather than hiding it: a panel showing a value of unknown age as
if it were current is the failure wave 1's own realtime plan calls out.

### `useComposer()`

bb's is 32 members. Ours is deliberately smaller — it exposes what the chamber's
composer actually has, and grows only when a real plugin needs more. The shape:

```ts
const composer = useComposer();
composer.text            // the draft, reactive
composer.isEmpty
composer.isSubmitting    // a run is in flight
composer.scope           // { kind: 'session' | 'new', sessionId }
composer.set(draft)      // replace the draft
composer.insert(text)    // insert at the caret
composer.focus()
```

**`set`/`insert` must not fight the user.** The composer is a controlled
`<textarea>` whose value the chat owns; a plugin write has to go through the
SAME state the chat uses, or the next keystroke reverts it. That means a service
the host injects (`composer.write`), not a DOM write.

**A read is reactive and a write is immediate.** bb's `draft` is reactive because
a banner renders its length; a write that also had to be awaited would make
`insert('@')` a two-step operation for the caller.

### Acceptance
- A plugin's `useRpc` call reaches its own server method and its own refusal
  surfaces as an error, not a thrown exception.
- `useRealtime` renders a value `api.realtime.publish` pushed, and reports
  `stale` when the socket drops.
- `useComposer().set()` changes the draft the user sees, and the next keystroke
  does not revert it.
- The harness (`@ompchamber/plugin-sdk/testing`) provides fakes for all three,
  so a plugin's tests do not need a host.

## W2 — `providerIcon`

The chamber already resolves a provider's mark from a 73-glyph table
(`src/client/components/common/provider-icon/`, `glyphs.ts` + `resolveProviderGlyph`),
and already falls back to the provider's initials. bb exposes the same thing as
a slot (`experimental_providerIcon`).

The slot is a REGISTRY, not a component list: a plugin registers `{ provider, glyph }`
and the resolver prefers a registered glyph for that provider over the built-in
one. **Resolution order is the contract** — a plugin's mark must win for the
provider it names and must not affect any other provider, or one plugin's icon
would silently replace another's.

### Acceptance
- A registered glyph renders in every surface that draws provider marks
  (settings list, model picker, usage cards) — they all already go through one
  component, so this is one resolution point.
- An unregistered provider is unchanged.
- Two plugins registering the same provider: the first wins, deterministically,
  and the second's registration is still accepted (it is a registry, not a
  positional slot).

## W3 — `pendingInteraction`

omp asks the agent's user questions through `extension_ui_request` with
`method: 'ask'`, and the chamber already renders them (`ask-panel/GroupedAsk.tsx`,
`hooks/chat/timeline/ask-frames.ts`). bb lets a plugin answer them
(`PluginPendingInteractionProps`: `{ interaction, submit, cancel }`).

This is the highest-value slot in the wave, because it is the only one where a
plugin changes what the agent DOES. A plugin can therefore automate an approval,
answer from its own storage, or refuse.

**Two rules that are not negotiable:**

1. **A plugin's answer is a normal answer.** It goes through the same
   `ExtensionDialogResponse` path a human click uses — same frame, same shape —
   or the agent receives something omp did not expect.
2. **A plugin may DECLINE.** If no plugin answers, the dialog renders exactly as
   it does today. A slot that could swallow a question with no answer would hang
   the agent, which is the worst failure in this file.

`submit`/`cancel` are the whole surface; there is no "partially answer".

### Acceptance
- A plugin's `submit` produces the same frame a human's click produces (asserted
  against the response shape, not against a mock).
- With no plugin registered, the dialog is byte-identical to today.
- A plugin that throws while rendering the interaction does not prevent the
  human from answering.

## W4 — `messageDirective`

A fenced block in an assistant message that renders as a plugin's component:

````
```omp:chart
{"series": [1, 2, 3]}
```
````

The chamber's markdown pipeline (`src/shared/lib/markdown/marked.ts`) has no
directive support today, so this is the one workstream with a real parser change.

**The fence must stay INERT when no plugin claims it.** Today an unknown fence
renders as a code block with its language badge; that must remain true, or every
plugin-less install starts rendering raw JSON as prose.

The directive's payload is parsed by the PLUGIN, not the host: the host passes
the raw text and the attributes, and a plugin that wants JSON parses JSON. A host
that guessed would have to own every plugin's schema.

### Acceptance
- An unclaimed fence renders exactly as it does today (pinned against the
  existing renderer's output).
- A claimed fence renders the plugin's component with the raw body.
- A plugin whose parser throws renders the fence as code, not as an error page.

## W5 — `contentScripts`

bb's `app.contentScripts.register({ id, mount })` mounts bundled JS that
enhances the app shell without rendering a slot. The host supplies
`{ pluginId, generation, signal }`, awaits mount, and owns exact-once
reverse-order disposal.

**This is the only workstream that lets a plugin touch DOM the host did not
hand it**, so it needs the strictest lifecycle in the file:

- **Disposal is exact-once and reverse-order**, across hash reload, disable,
  removal and window teardown. A content script that mounts twice doubles its
  listeners; one that never unmounts leaks them for the life of the page.
- **The old generation is disposed BEFORE a new one mounts**, so two generations
  never overlap.
- **`signal` aborts on teardown**, so an async mount cannot finish after its own
  disposal.
- **A throwing mount is reported**, and the host rolls back what it owns: its
  own generation RECORD, so a failed mount leaves nothing the reaper can never
  reach. The DOM a script added is the script's own to undo — the contract hands
  it no container, so a host-side rollback of those nodes is not possible and is
  not claimed. (An earlier revision staged the mount in a detached container and
  moved its children into the document on success; the container was never
  handed to the script, so the loop moved zero nodes and the rollback never
  fired. Removed.)

The stylesheet half is **answered by measurement, and the answer is "none
needed"**, not deferred:

- A plugin's bundle is an ES module imported into the host's document, so it
  renders with the host's own Tailwind classes and theme variables already in
  the stylesheet (see the README's "Styling" section). There is no `oc-*` layer
  to ship and nothing to activate or deactivate.
- A plugin that imports CSS anyway gets an **inert** artifact, verified: `Bun.build`
  emits `dist/app.css` BESIDE `dist/app.js` and the JS never references it, so the
  file is simply never fetched. That is a silent trap, and the fix is the build
  failing loudly, not a host-side stylesheet lifecycle.
- A live-generation lifecycle for CSS would have nothing to toggle: the artifact
  above is not loaded at all, and the documented path (host utilities) is always
  on. Building the lifecycle would have meant building the loader that makes it
  meaningful — an app-wide stylesheet hook, which this file excludes.

So no `contentScripts` stylesheet half ships. The trap is recorded where a plugin
author will hit it.

### Acceptance
- A mount/dispose cycle removes exactly the nodes the scripts added, and
  unmounting twice runs each disposer ONCE (asserted on the document, not on a
  mock).
- A reload disposes generation N before mounting N+1 — the disposal line comes
  before the mount line.
- A throwing mount reports its reason and leaves no generation record; one
  broken script does not stop the next one mounting.
- The `signal` aborts on teardown, and a mount that resolves after its own
  teardown still has its disposer run.

## W6 — Component registry: re-evaluated, still NO

Wave 1's P6 decided no, with the evidence that eight new slots needed no
component the kit lacks. W2–W5 add four more surfaces, and the answer holds:

| New surface | What it needed from the kit |
|---|---|
| `providerIcon` | Nothing — a plugin supplies SVG source, and the host's existing mark component draws it. |
| `pendingInteraction` | Nothing — the plugin renders its own controls; the host supplies `submit`/`cancel`. |
| `messageDirective` | Nothing — a plugin's component, with the fence body as a prop. |
| `contentScript` | Nothing — the plugin owns its own DOM. |

Twelve surfaces now, and **not one has needed a primitive the kit does not
ship**. That is the evidence the phase existed to wait for, and it is consistent
across both waves, so the decision is re-recorded rather than revisited.

What bb's registry genuinely buys is component BREADTH (Radix primitives,
tables, charts) for plugins that want a rich UI. A plugin that wants those
depends on the library directly — the chamber is a Preact-native world, so
`lucide-preact` or a hand-rolled primitive is the same work either way, and the
chamber does not have to own a generated registry to make that possible. bb's
registry exists because bb REMOVED its kit; a registry that duplicates a working
kit is a second place for a component to live.

**Revisit if:** a real plugin needs a component whose implementation is large and
host-coupled (a virtualized table reading the chamber's session store, say). Then
the answer is a new module in `@ompchamber/ui`, not a registry.

## Sequencing

1. **Contract + services seam** (one writer, no parallelism): the three hooks'
   types, the `providerIcon`/`pendingInteraction`/`messageDirective`/`contentScripts`
   registration types, and the `UiKitServices` additions they read.
2. **W1** — the kit hooks. Blocks nothing but is read by everything, so it lands
   before the surfaces that would otherwise hand-roll it.
3. **W2, W3, W4** — independent surfaces, parallelizable once (1) is in.
4. **W5** — its own lifecycle, its own surface.
5. **W6** — evaluation only.
6. **Docs** — `docs/panel-plugins/README.md` and this file.

Every workstream must pass: `bun run lint`, `bunx tsc --noEmit --noUnusedLocals
--noUnusedParameters`, the 350-line check, `bun run build`, `bun test`.

## Out of scope, permanently

`providers`, `environment-provider`, `machine-provider`, `provider-bridge`,
`hosts`, `agents`, `sdk`, `experimental_environments`, `experimental_machines`,
`experimental_serverAccess`, `experimental_aiServices`, `cli`. Each exists in bb
because bb ships the agent runtime and lets a plugin supply or extend it. The
chamber's agent is omp, reached over RPC; a plugin does not replace it. This is
D1 of the wave-1 plan and it is not revisited here.

`useSidebarThreads` / `experimental_useSidebarThreadActions` / the thread-list
replacement family is **deferred, not refused**: it is a large surface whose
value depends on a plugin actually wanting to own the sidebar, and W1's
`useComposer` is the cheaper way to find out whether plugins want to drive the
app at all.
