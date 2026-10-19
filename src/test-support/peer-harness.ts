/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test harness for the peer (multi-instance) realtime path.
 *
 * Two pieces, because both are awkward to build inside a test body:
 *
 *   - a RAW peer speaking the realtime wire protocol. The hub is process-wide
 *     (`globalThis`), so an in-process "owner" would share it with the relay
 *     under test and could exercise nothing; a raw socket is the only way to be
 *     genuinely other.
 *   - a lease holder in a SEPARATE, reparented process. The ownership guard
 *     treats a lease held by this very process — and a child this process
 *     spawned — as "our own", so a foreign holder has to be detached.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RealtimeConnection } from '@/server/lib/realtime/hub.server';
import { sessionLeasePath } from '@/server/lib/omp/session/ownership.server';
import { leaseHeldByAnother } from '@/server/lib/omp/session/lease-flock.server';
import type { RealtimeServerFrame } from '@/shared/lib/realtime/protocol';

/** Spin the event loop until `condition` holds, up to `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition never held');
}

/** A connection that hands each frame to whoever is waiting for it. */
export interface RecordingConnection extends RealtimeConnection {
  frames: RealtimeServerFrame[];
  awaitFrame: (match: (frame: RealtimeServerFrame) => boolean) => Promise<RealtimeServerFrame>;
}

export function recordingConnection(): RecordingConnection {
  const frames: RealtimeServerFrame[] = [];
  let waiter: { match: (frame: RealtimeServerFrame) => boolean; resolve: (frame: RealtimeServerFrame) => void } | null = null;
  return {
    topics: new Set(),
    snapshotted: new Set(),
    closed: false,
    frames,
    awaitFrame(match) {
      const hit = frames.find(match);
      if (hit) return Promise.resolve(hit);
      const { promise, resolve } = Promise.withResolvers<RealtimeServerFrame>();
      waiter = { match, resolve };
      return promise;
    },
    send: (frame) => {
      frames.push(frame);
      const pending = waiter;
      if (pending?.match(frame)) {
        waiter = null;
        pending.resolve(frame);
      }
    },
  };
}

/** What the fake owner's socket saw and sent, for assertions. */
export interface FakePeer {
  port: number;
  /** The upgrade paths the relay dialed, in arrival order. */
  paths: string[];
  /** The topic lists the relay subscribed with, in arrival order. */
  subscriptions: string[][];
  /** Push a frame to every connected relay, as the owner's hub would. */
  send: (frame: RealtimeServerFrame) => void;
  stop: () => void;
}

/**
 * A raw peer: accepts upgrades and speaks the realtime surface the relay needs
 * (an inbound `subscribe`, outbound `snapshot`/`delta`).
 *
 * The dialed PATH is recorded, because that is where the relay's bug lived: a
 * relay aimed at the deleted `/api/agent/<id>/ws` reaches a route that does not
 * exist, so on a real server it never upgrades at all.
 */
export function startFakePeer(): FakePeer {
  const sockets = new Set<{ send: (data: string) => void }>();
  const paths: string[] = [];
  const subscriptions: string[][] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      paths.push(new URL(request.url).pathname);
      if (srv.upgrade(request)) return undefined;
      return new Response('expected a websocket upgrade', { status: 426 });
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
      },
      message(_ws, raw) {
        const frame = JSON.parse(String(raw)) as { t?: string; topics?: string[] };
        if (frame.t === 'subscribe' && Array.isArray(frame.topics)) subscriptions.push(frame.topics);
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
  });
  // `port` is optional on the type (a unix-socket listener has none) but always
  // present for a TCP bind; narrow on it rather than asserting a shape.
  if (typeof server.port !== 'number') throw new Error('fake peer has no port');
  return {
    port: server.port,
    paths,
    subscriptions,
    send: (frame) => {
      for (const socket of sockets) socket.send(JSON.stringify(frame));
    },
    stop: () => server.stop(true),
  };
}

/**
 * The two directories the ownership guard reads, redirected into temp roots.
 *
 * Both MUST be redirected: without them the guard inspects the developer's real
 * `~/.omp` and `~/.kabmo`, where a live session of the same id — or a real
 * running instance — would decide the answer instead of the test's fixture.
 */
export interface PeerRoots {
  stateRoot: string;
  dataRoot: string;
  restore: () => void;
}

export function usePeerRoots(): PeerRoots {
  const stateRoot = join(tmpdir(), `kabmo-peer-state-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const dataRoot = join(tmpdir(), `kabmo-peer-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  // `sessionOwnersDir` takes the XDG branch only once the app root exists.
  mkdirSync(join(stateRoot, 'omp', 'run', 'session-owners'), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });

  const saved = {
    state: Bun.env.XDG_STATE_HOME,
    data: Bun.env.KABMO_DATA_DIR,
    agent: Bun.env.PI_CODING_AGENT_DIR,
    db: Bun.env.KABMO_DB_PATH,
  };
  Bun.env.XDG_STATE_HOME = stateRoot;
  Bun.env.KABMO_DATA_DIR = dataRoot;
  Bun.env.PI_CODING_AGENT_DIR = join(stateRoot, 'agent');
  Bun.env.KABMO_DB_PATH = join(dataRoot, 'db.sqlite');
  delete globalThis.__kabmoDb;

  return {
    stateRoot,
    dataRoot,
    restore: () => {
      if (saved.state === undefined) delete Bun.env.XDG_STATE_HOME;
      else Bun.env.XDG_STATE_HOME = saved.state;
      if (saved.data === undefined) delete Bun.env.KABMO_DATA_DIR;
      else Bun.env.KABMO_DATA_DIR = saved.data;
      if (saved.agent === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
      else Bun.env.PI_CODING_AGENT_DIR = saved.agent;
      if (saved.db === undefined) delete Bun.env.KABMO_DB_PATH;
      else Bun.env.KABMO_DB_PATH = saved.db;
    },
  };
}

/**
 * Hold `sessionId`'s lease from a SEPARATE, REPARENTED process — the shape a
 * real second Kabmo instances's omp child has.
 *
 * A lease held by this very process is deliberately NOT a conflict (the local
 * registry already answers for it), and a directly-spawned child is "our own
 * child" by the guard's parent rule — so the holder must be detached. The
 * `sh -c '… &'` wrapper exits at once and leaves `bun` under init, which is the
 * portable way to get a foreign holder (macOS ships no `setsid`).
 */
export async function holdLeaseInForeignProcess(sessionId: string): Promise<number> {
  const lease = sessionLeasePath(sessionId);
  writeFileSync(lease, '');
  const script = `
    const { holdLeaseForTest } = await import(${JSON.stringify(join(import.meta.dir, '..', 'server/lib/omp/session/lease-flock.server.ts'))});
    holdLeaseForTest(process.argv[1]);
    await Promise.withResolvers().promise;
  `;
  const inner = `exec ${JSON.stringify(process.execPath)} -e '${script.replace(/'/g, `'\\''`)}' '${lease}'`;
  const child = Bun.spawn(['sh', '-c', `{ ${inner} >/dev/null 2>&1 & } ; echo $!`], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...Bun.env },
  });
  const pid = Number((await new Response(child.stdout).text()).trim());
  await waitUntil(() => leaseHeldByAnother(lease) === true);
  return pid;
}
