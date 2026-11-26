import { useMemo } from 'preact/hooks';
import type { GitChange } from '@kabmo-labs/kabmo-app-contracts/git';
import { buildGitStatusMaps } from '@/shared/lib/fs/git-status';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import type { GitStatusPayload } from '@/server/lib/fs/git-status-read';

/** Shared empty list, so a clean tree keeps one array identity across renders. */
const NO_CHANGES: GitChange[] = [];

export function useGitStatus(
  rootPath?: string,
  activeRepo: string = '.',
  enabled: boolean = true,
) {
  // The tree these changes describe. A response and the state it fills are both
  // tagged with it, so a read that lands after the scope moved can never be
  // rendered as the new scope's: the activity bar's dot would then describe the
  // previous repository for as long as the new read takes.
  const scope = `${rootPath ?? ''}\u0000${activeRepo}`;
  // The status rides the `git:<root>\0<repo>` topic: the server pushes a fresh
  // read when a run's work may have touched the tree, so the poll, the
  // event-driven re-read and the focus/visibility probes are all gone.
  const topic = useRealtimeTopic<GitStatusPayload>(enabled ? gitTopic(scope) : null);

  // A payload is only rendered for the scope it was asked for: a switch leaves
  // the previous tree's list in the topic cache for the frame before the new
  // snapshot lands, and the activity bar's dot would then describe the
  // repository the user just left. The tag is the TOPIC's own scope, so a
  // revisit (root → repo → root) cannot inherit the earlier visit's answer.
  const changes = useMemo(
    () => (Array.isArray(topic.data?.changes) ? topic.data.changes : NO_CHANGES),
    [topic.data],
  );

  const { fileMap, folderMap } = useMemo(() => {
    return buildGitStatusMaps(changes);
  }, [changes]);

  return {
    changes,
    fileMap,
    folderMap,
    isLoading: topic.isLoading,
    /** Ask the server for a fresh read (a panel's own Refresh). */
    refreshGitStatus: topic.refresh,
  };
}
