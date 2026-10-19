import { describe, expect, test } from 'bun:test';
import entry from './index';
import type { ExtensionCtx, ModeApi, ModeSession } from './session';

describe('command registration', () => {
  test('registers both the current and the pre-rename mode command', () => {
    const registered: string[] = [];
    const session: ModeSession = {
      getPlanModeState: () => undefined,
      setPlanModeState: () => {},
      getPlanReferencePath: () => 'local://PLAN.md',
      getEnabledToolNames: () => [],
      setActiveToolsByName: async () => {},
      sessionManager: { appendModeChange: () => 'id', getSessionId: () => 's1' },
    };
    const api: ModeApi = {
      appendEntry: () => {},
      sendMessage: () => {},
      registerCommand: (name) => { registered.push(name); },
      pi: { AgentRegistry: { global: () => ({ list: () => [{ id: 's1', session }] }) } },
    };
    entry(api);
    expect(registered).toContain('kabmo-mode');
    expect(registered).toContain('chamber-mode');
  });
});
