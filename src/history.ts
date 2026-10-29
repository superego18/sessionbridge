import type { ParsedHistoryEvent, ParsedTurn, ParsedToolCall } from "./types.js";

export function unfinishedToolNote(call: ParsedToolCall): string {
  return `[Unfinished source tool call: ${call.toolName}; outcome unknown]\n${call.arguments}\n`
    + "No result was captured. The action may have run; do not automatically retry. Check the current working tree first.";
}

export function historyEvents(turn: ParsedTurn): ParsedHistoryEvent[] {
  if (turn.events) return turn.events;
  const events: ParsedHistoryEvent[] = turn.assistantMessages.map(text => ({ type: "assistant", text }));
  turn.toolCalls.forEach((call, callIndex) => {
    events.push({ type: "tool_call", callIndex });
    if (call.output !== undefined) events.push({ type: "tool_result", callIndex });
  });
  return events;
}
