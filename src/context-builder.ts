import type { ParsedSession } from "./types.js";
import { historyEvents } from "./history.js";

// Preserve full text in source order. The receiving model still has its own context limit.
export function buildContextSummary(session: ParsedSession): string {
  const lines = ["# Source Session Context", "", `- Session ID: ${session.sessionId}`,
    `- Project: ${session.cwd}`, `- Source model: ${session.model}`,
    `- Git branch: ${session.gitBranch || ""}`, `- Git commit: ${session.gitCommitHash || ""}`,
    `- Time: ${session.startTime} ~ ${session.endTime}`, `- Total turns: ${session.turns.length}`, ""];
  for (const turn of session.turns) {
    lines.push(`## Turn ${turn.index + 1}`, "", "**User**:", turn.userMessage, "");
    for (const event of historyEvents(turn)) {
      if (event.type === "assistant") {
        lines.push("**Assistant**:", event.text, "");
      } else {
        const call = turn.toolCalls[event.callIndex];
        lines.push(`**${event.type}: ${call.toolName}**`,
          event.type === "tool_call" ? call.arguments : call.output ?? "", "");
      }
    }
    if (turn.reasoningCount) lines.push(`Source reasoning records: ${turn.reasoningCount}. Only readable text is projected; ciphertext requires the source archive.`, "");
  }
  if (session.filesChanged.length) lines.push("## Files mentioned as changed", ...session.filesChanged, "");
  lines.push("This is projected history, not a restoration of source permissions, external files, other sessions or encrypted reasoning.");
  return lines.join("\n");
}
