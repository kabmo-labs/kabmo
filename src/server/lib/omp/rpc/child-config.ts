/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The commands a freshly-spawned child is configured with, before any prompt.
 *
 * Split out of `manager.ts` (which is at the repo's per-file ceiling) so the
 * attach sequence reads as one list rather than being interleaved with the
 * wrapper's own state. Each entry is BEST-EFFORT: an older omp answers
 * `Unknown command` and the run continues on that build's defaults, which is
 * why none of them may throw.
 *
 * `set_event_filter` keeps the FULL accumulated message on every `message_update`
 * frame — the projection omp calls `"full"` and the one it uses by default.
 * Delta mode (`messageUpdates: "delta"`) was measured ~101x smaller on the wire
 * (108 KB / 486 frames against 10.9 MB / 2217 on a 300-word prompt), but it
 * drops the identity a streaming tool call needs: `toolcall_delta` carries ONLY
 * `{contentIndex, delta}`, and `toolcall_start` carries no block at all. The
 * name and id live on the seed block, and `message_start`'s snapshot does not
 * reliably contain it — measured on omp 18.10.3, the same model produced a seed
 * of `[text, toolCall]` on one run and `[thinking]` on the next, so a card
 * rendered a bare **Tool** for the whole argument stream and only snapped to
 * `Write — <path>` at `toolcall_end` (which also remounted it, dropping the
 * reader's expand state). `full` makes the name and id readable from the first
 * delta, at the cost of the accumulated snapshot per frame.
 *
 * Nothing else changes: the terminal frames (`message_start`, `message_end`,
 * `turn_end`, `agent_end`) carry the full message either way.
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';

/** Apply the attach-time configuration to a child that just became ready. */
export async function configureChild(proc: RpcProcess): Promise<void> {
  // Subagent lifecycle/progress/event frames, so the UI can show a live roster.
  await proc.sendCommand({ type: 'set_subagent_subscription', level: 'events' }).catch(() => {});
  // Full accumulated `message_update` frames (see the module doc): the streaming
  // tool call's name/id live on the seed block, which delta mode drops.
  await proc.sendCommand({ type: 'set_event_filter', events: null, messageUpdates: 'full' }).catch(() => {});
  // Grouped `ask` dialogs: every question of one `ask` tool call in a SINGLE
  // `extension_ui_request` (`method:"ask"`, with `multi`/`recommended`), answered
  // by one `answers` response. Without this omp loops one `select` per question,
  // which is what the ask card's per-question bookkeeping exists to reassemble.
  // Verified on 18.8.3: two questions (one `multi`) arrived in one request.
  await proc.sendCommand({ type: 'set_ask_dialog', enabled: true }).catch(() => {});
}
