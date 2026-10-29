import type { ParsedHistoryEvent, ParsedTurn } from "./types.js";

export function historyEvents(turn: ParsedTurn): ParsedHistoryEvent[] {
  if (turn.events) return turn.events;
  const events: ParsedHistoryEvent[] = turn.assistantMessages.map(text => ({ type: "assistant", text }));
  turn.toolCalls.forEach((call, callIndex) => {
    events.push({ type: "tool_call", callIndex });
    if (call.output !== undefined) events.push({ type: "tool_result", callIndex });
  });
  return events;
}
