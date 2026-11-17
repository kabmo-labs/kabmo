import type { RawMessageItem, SessionContextTelemetry } from '@/shared/types';
import { rawPayload1, rawPayload2, rawPayload3, rawPayload4, rawPayload5 } from '@/client/data/context-data/presets';

export function computeSessionContextTelemetry(
  sessionId: string | null,
  sessionTitle?: string,
  messages: any[] = [],
  contextLimit: number = 1_000_000,
): SessionContextTelemetry {
  const currentTitle = sessionTitle || (sessionId ? `Session ${sessionId}` : 'History Commit 2026-09-06 23:00');
  const now = new Date();
  const timeFormatted = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateFormatted = `${now.getMonth() + 1}/${now.getDate()}, ${timeFormatted}`;

  // If there are no messages, this is a newly started (or empty) session —
  // show a zeroed telemetry rather than fabricated demo data. The caller's
  // `contextLimit` still applies: the window belongs to the model that will
  // run the first turn, not to a constant.
  if (!messages || messages.length === 0) {
    return emptyTelemetry(sessionId || 'default', currentTitle, contextLimit);
  }

  let userCount = 0;
  let assistantCount = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalReasoning = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalUserChars = 0;
  let totalAiChars = 0;
  let totalToolChars = 0;

  const rawMessages: RawMessageItem[] = [];

  messages.forEach((msg, index) => {
    const isUser = msg.role === 'user';

    if (isUser) {
      userCount++;
      totalUserChars += (msg.content?.length || 0);
    } else {
      assistantCount++;
      totalAiChars += (msg.content?.length || 0);
    }

    // Inspect tools
    const toolCalls = msg.toolCalls || [];
    const hasBash = toolCalls.some((t: any) => t.type === 'bash');
    const hasRead = toolCalls.some((t: any) => t.type === 'read_file' || t.type === 'view_file');
    const hasEdit = toolCalls.some((t: any) => t.type === 'edit_file' || t.type === 'create_file');
    const hasThinking = Boolean(msg.thinking);

    toolCalls.forEach((tc: any) => {
      totalToolChars += (tc.command?.length || 0) + (tc.output?.length || 0);
    });

    // Badge label construction
    let badgeLabel = '';
    let type = 'text';

    if (isUser) {
      const snippet = msg.content?.slice(0, 70) || 'User Prompt';
      badgeLabel = `user: ${snippet}${msg.content?.length > 70 ? '...' : ''}`;
      type = 'user';
    } else {
      const parts: string[] = [];
      if (hasThinking) parts.push('reasoning');
      if (msg.content) parts.push('text');
      if (hasBash) parts.push('bash');
      if (hasRead) parts.push('read');
      if (hasEdit) parts.push('edit');

      badgeLabel = parts.length > 0 ? parts.join(' + ') : 'text';
      type = parts.join('_');
    }

    // Approximate token counts
    const inTokens = Math.max(120, Math.round((msg.content?.length || 50) * 1.3) + (toolCalls.length * 280) + (index * 450));
    const outTokens = isUser ? 0 : Math.max(45, Math.round((msg.content?.length || 100) * 0.45));
    const reasoningTokens = hasThinking ? Math.max(80, Math.round(outTokens * 0.8)) : 0;
    const cacheReadTokens = isUser ? 0 : Math.max(10000, inTokens * 15 + index * 12000);
    const cacheWriteTokens = 0;

    totalInput += inTokens;
    totalOutput += outTokens;
    totalReasoning += reasoningTokens;
    totalCacheRead += cacheReadTokens;
    totalCacheWrite += cacheWriteTokens;

    const msgCost = ((inTokens * 0.14) + (outTokens * 0.28) + (cacheReadTokens * 0.014)) / 1_000_000;

    const rawPayload = {
      info: {
        id: msg.id || `msg_${Math.random().toString(36).substring(2, 12)}`,
        parentID: index > 0 ? messages[index - 1].id : undefined,
        role: msg.role === 'ai' ? 'assistant' : msg.role,
        mode: "Sisyphus - ultraworker",
        agent: "Sisyphus - ultraworker",
        path: {
          cwd: "/Users/rajebdev/JatisMobile/Workspace",
          root: "/Users/rajebdev/JatisMobile/Workspace"
        },
        cost: Number(msgCost.toFixed(8)),
        tokens: {
          total: inTokens + outTokens + cacheReadTokens,
          input: inTokens,
          output: outTokens,
          reasoning: reasoningTokens,
          cache: {
            write: cacheWriteTokens,
            read: cacheReadTokens
          }
        },
        modelID: "deepseek/deepseek-v4-flash"
      }
    };

    rawMessages.push({
      id: msg.id || `raw-${index}`,
      type,
      badgeLabel,
      tokenSummary: isUser ? '' : `${inTokens.toLocaleString()} / ${outTokens.toLocaleString()}`,
      timestamp: msg.date || dateFormatted,
      info: rawPayload.info,
      rawPayload
    });
  });

  const totalCostVal = ((totalInput * 0.14) + (totalOutput * 0.28) + (totalCacheRead * 0.014)) / 1_000_000;

  // Last assistant message stats
  const lastAiMessage = [...rawMessages].reverse().find(m => m.info.role === 'assistant');
  const lastMsgInput = lastAiMessage?.info.tokens.input || 1013;
  const lastMsgOutput = lastAiMessage?.info.tokens.output || 172;
  const lastMsgReasoning = lastAiMessage?.info.tokens.reasoning || 152;
  const lastMsgCacheRead = lastAiMessage?.info.tokens.cache.read || 62080;
  const lastMsgCacheWrite = lastAiMessage?.info.tokens.cache.write || 0;
  const cacheHitPercent = lastMsgCacheRead > 0 ? 98.4 : 0;

  // oh-my-pi semantics: current context occupancy is the latest anchored provider
  // prompt estimate (input + cacheRead + cacheWrite), never the cumulative
  // session/billing sums. With no assistant turn there is no occupancy to show.
  const contextUsed = lastAiMessage
    ? lastAiMessage.info.tokens.input + lastAiMessage.info.tokens.cache.read + lastAiMessage.info.tokens.cache.write
    : 0;
  const contextPercent = Math.min(100, Math.max(0, Number(((contextUsed / contextLimit) * 100).toFixed(1))));

  // Compute distribution percentages
  const grandChars = Math.max(1, totalUserChars + totalAiChars + totalToolChars + 500);
  const userPct = Math.max(4, Math.round((totalUserChars / grandChars) * 100));
  const aiPct = Math.max(35, Math.round((totalAiChars / grandChars) * 100));
  const toolPct = totalToolChars > 0 ? Math.max(6, Math.round((totalToolChars / grandChars) * 100)) : 8;
  const otherPct = Math.max(10, 100 - userPct - aiPct - toolPct);

  return {
    sessionId: sessionId || 'default',
    sessionTitle: currentTitle,
    modelId: 'deepseek/deepseek-v4-flash',
    modelName: 'DeepSeek V4 Flash',
    timestamp: dateFormatted,
    contextUsed,
    contextLimit,
    contextPercent,
    messagesCount: messages.length,
    userCount,
    assistantCount,
    totalCost: totalCostVal,
    costFormatted: totalCostVal < 0.01 ? '$0.01' : `$${totalCostVal.toFixed(2)}`,
    cacheHitAverage: cacheHitPercent,
    costBreakdown: {
      input: (totalInput * 0.14) / 1_000_000,
      output: (totalOutput * 0.28) / 1_000_000,
      cacheRead: (totalCacheRead * 0.014) / 1_000_000,
      cacheWrite: 0,
      total: totalCostVal,
    },
    totals: {
      total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
      input: totalInput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      output: totalOutput,
      reasoning: totalReasoning,
    },
    lastMessage: {
      input: lastMsgInput,
      output: lastMsgOutput,
      reasoning: lastMsgReasoning,
      cacheRead: lastMsgCacheRead,
      cacheWrite: lastMsgCacheWrite,
      cacheHitPercent
    },
    distribution: {
      userTokens: totalUserChars,
      userPercent: userPct,
      assistantTokens: totalAiChars,
      assistantPercent: aiPct,
      toolTokens: totalToolChars,
      toolPercent: toolPct,
      otherTokens: totalCacheRead,
      otherPercent: otherPct
    },
    rawMessages
  };
}

export function emptyTelemetry(sessionId: string, sessionTitle: string, contextLimit: number = 1_000_000): SessionContextTelemetry {
  return {
    sessionId,
    sessionTitle,
    modelId: '',
    modelName: '',
    timestamp: '',
    contextUsed: 0,
    contextLimit,
    contextPercent: 0,
    messagesCount: 0,
    userCount: 0,
    assistantCount: 0,
    totalCost: 0,
    costFormatted: '$0.00',
    cacheHitAverage: 0,
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    lastMessage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cacheHitPercent: 0 },
    distribution: { userTokens: 0, userPercent: 0, assistantTokens: 0, assistantPercent: 0, toolTokens: 0, toolPercent: 0, otherTokens: 0, otherPercent: 100 },
    rawMessages: [],
  };
}

export function getDefaultMockTelemetry(sessionId: string, sessionTitle: string): SessionContextTelemetry {
  return {
    sessionId,
    sessionTitle,
    modelId: "deepseek/deepseek-v4-flash",
    modelName: "DeepSeek V4 Flash",
    timestamp: "Sep 6, 2026, 11:00 PM",
    contextUsed: 63417,
    contextLimit: 1000000,
    contextPercent: 6.3,
    messagesCount: 5,
    userCount: 1,
    assistantCount: 4,
    totalCost: 0.01,
    costFormatted: "$0.01",
    cacheHitAverage: 98.4,
    costBreakdown: {
      input: 0.00009,
      output: 0.000099,
      cacheRead: 0.000914,
      cacheWrite: 0,
      total: 0.01
    },
    totals: {
      total: 450 + 3500 + 2900 + 600,
      input: 450,
      cacheRead: 2900,
      cacheWrite: 600,
      output: 3500,
      reasoning: 152
    },
    lastMessage: {
      input: 1013,
      output: 172,
      reasoning: 152,
      cacheRead: 62080,
      cacheWrite: 0,
      cacheHitPercent: 98.4
    },
    distribution: {
      userTokens: 450,
      userPercent: 6,
      assistantTokens: 3500,
      assistantPercent: 47,
      toolTokens: 600,
      toolPercent: 8,
      otherTokens: 2900,
      otherPercent: 39
    },
    rawMessages: [
      {
        id: "msg-1",
        type: "reasoning_text",
        badgeLabel: "reasoning + text",
        tokenSummary: "1,013 / 172",
        timestamp: "9/6, 11:00 PM",
        info: rawPayload1.info,
        rawPayload: rawPayload1
      },
      {
        id: "msg-2",
        type: "reasoning_text_bash",
        badgeLabel: "reasoning + text + bash",
        tokenSummary: "485 / 149",
        timestamp: "9/6, 11:00 PM",
        info: rawPayload2.info,
        rawPayload: rawPayload2
      },
      {
        id: "msg-3",
        type: "reasoning_bash",
        badgeLabel: "reasoning + bash",
        tokenSummary: "228 / 92",
        timestamp: "9/6, 11:00 PM",
        info: rawPayload3.info,
        rawPayload: rawPayload3
      },
      {
        id: "msg-4",
        type: "reasoning_bash",
        badgeLabel: "reasoning + bash",
        tokenSummary: "54,266 / 85",
        timestamp: "9/6, 11:00 PM",
        info: rawPayload4.info,
        rawPayload: rawPayload4
      },
      {
        id: "msg-5",
        type: "user",
        badgeLabel: "user: You are generating and commiting a Conventional Commits subject line using session context and se...",
        tokenSummary: "",
        timestamp: "9/6, 11:00 PM",
        info: rawPayload5.info,
        rawPayload: rawPayload5
      }
    ]
  };
}
