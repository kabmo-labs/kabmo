import type { SubagentHistoryEntry, SubagentMessagesPage } from '@kabmo-labs/kabmo-omp-contracts/subagent';
import { SAMPLE_SCOUT_SUBAGENT_ID, SAMPLE_SLEEPER_SUBAGENT_ID, SAMPLE_SUBAGENT_SESSION_ID, rawScoutSubagentEvents, rawSleeperSubagentEvents, scoutSubagentHistoryEntry, sleeperSubagentHistoryEntry } from '@/client/data/samples/subagent-session';

export const MOCK_SUBAGENTS_MAP: Record<string, SubagentHistoryEntry[]> = {
  '1': [
    scoutSubagentHistoryEntry,
    sleeperSubagentHistoryEntry,
    {
      id: 'subagent-1',
      agent: 'Sisyphus',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Client history merge + expand all (@Sisyphus)',
      assignment: 'Client history merge + expand all (@Sisyphus)',
      description: 'Client history merge + expand all (@Sisyphus)',
      index: 1,
      durationMs: 120,
      cost: 0.0008,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-2',
      agent: 'Sisyphus',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Subagent history extractor + API (@Sisyphus)',
      assignment: 'Subagent history extractor + API (@Sisyphus)',
      description: 'Subagent history extractor + API (@Sisyphus)',
      index: 2,
      durationMs: 95,
      cost: 0.0006,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-3',
      agent: 'look_at',
      agentSource: 'bundled',
      status: 'completed',
      task: 'look_at: Describe the subagent transcript view layout',
      assignment: 'look_at: Describe the subagent transcript view layout',
      description: 'look_at: Describe the subagent transcript view layout',
      index: 3,
      durationMs: 80,
      cost: 0.0005,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-4',
      agent: 'look_at',
      agentSource: 'bundled',
      status: 'completed',
      task: 'look_at: Describe the left sidebar: is there a subagent tree',
      assignment: 'look_at: Describe the left sidebar: is there a subagent tree',
      description: 'look_at: Describe the left sidebar: is there a subagent tree',
      index: 4,
      durationMs: 85,
      cost: 0.0005,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-5',
      agent: 'Sisyphus',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Sidebar expandable subagent list (@Sisyphus)',
      assignment: 'Sidebar expandable subagent list (@Sisyphus)',
      description: 'Sidebar expandable subagent list (@Sisyphus)',
      index: 5,
      durationMs: 110,
      cost: 0.0007,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-6',
      agent: 'Sisyphus',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Subagent transcript view + hook (@Sisyphus)',
      assignment: 'Subagent transcript view + hook (@Sisyphus)',
      description: 'Subagent transcript view + hook (@Sisyphus)',
      index: 6,
      durationMs: 140,
      cost: 0.0009,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-7',
      agent: 'explore',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Explore omp RPC bridge layer (@explore)',
      assignment: 'Explore omp RPC bridge layer (@explore)',
      description: 'Explore omp RPC bridge layer (@explore)',
      index: 7,
      durationMs: 160,
      cost: 0.0011,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-8',
      agent: 'explore',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Explore chat timeline streaming (@explore)',
      assignment: 'Explore chat timeline streaming (@explore)',
      description: 'Explore chat timeline streaming (@explore)',
      index: 8,
      durationMs: 130,
      cost: 0.0009,
      transcriptAvailable: true,
    },
    {
      id: 'subagent-9',
      agent: 'explore',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Explore session sidebar structure (@explore)',
      assignment: 'Explore session sidebar structure (@explore)',
      description: 'Explore session sidebar structure (@explore)',
      index: 9,
      durationMs: 90,
      cost: 0.0006,
      transcriptAvailable: true,
    },
  ],
  [SAMPLE_SUBAGENT_SESSION_ID]: [
    scoutSubagentHistoryEntry,
  ],
  '3': [
    {
      id: 'subagent-state-1',
      agent: 'state_builder',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Persist state hydration for session timeline',
      assignment: 'Persist state hydration for session timeline',
      description: 'State serialization & local recovery',
      index: 0,
      durationMs: 85,
      cost: 0.0007,
      transcriptAvailable: true,
    },
  ],
  '4': [
    {
      id: 'subagent-model-1',
      agent: 'ui_designer',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Review loading spinner and intent banner',
      assignment: 'Review loading spinner and intent banner',
      description: 'Intent header title alignment',
      index: 0,
      durationMs: 70,
      cost: 0.0005,
      transcriptAvailable: true,
    },
  ],
  '5': [
    {
      id: 'subagent-queue-1',
      agent: 'queue_worker',
      agentSource: 'bundled',
      status: 'completed',
      task: 'Queue processing dispatcher verification',
      assignment: 'Queue processing dispatcher verification',
      description: 'Verify stream status and queue list',
      index: 0,
      durationMs: 95,
      cost: 0.0006,
      transcriptAvailable: true,
    },
  ],
};

export function getMockSubagents(sessionId: string | number): SubagentHistoryEntry[] {
  const key = String(sessionId);
  return MOCK_SUBAGENTS_MAP[key] || [];
}

export function hasMockSubagents(sessionId: string | number): boolean {
  const list = getMockSubagents(sessionId);
  return list.length > 0;
}

export function getMockSubagentTranscriptPage(
  subagentId: string,
  _sessionId?: string | number,
): SubagentMessagesPage | null {
  if (subagentId === SAMPLE_SLEEPER_SUBAGENT_ID) {
    return {
      sessionFile: `/sample/${SAMPLE_SLEEPER_SUBAGENT_ID}.jsonl`,
      fromByte: 0,
      nextByte: 2048,
      reset: false,
      messages: rawSleeperSubagentEvents,
      totalBytes: 2048,
    };
  }
  // Return the scout subagent transcript events
  if (subagentId === SAMPLE_SCOUT_SUBAGENT_ID || subagentId.startsWith('subagent-')) {
    return {
      sessionFile: `/sample/${SAMPLE_SCOUT_SUBAGENT_ID}.jsonl`,
      fromByte: 0,
      nextByte: 1024,
      reset: false,
      messages: rawScoutSubagentEvents,
      totalBytes: 1024,
    };
  }
  return null;
}
