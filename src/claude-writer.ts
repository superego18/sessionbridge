import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { ParsedSession, ClaudeRecord, ClaudeContentBlock } from "./types.js";
import { TOOL_NAME_MAP } from "./types.js";
import { historyEvents } from "./history.js";

export function writeClaudeSession(session: ParsedSession): { sessionId: string; filePath: string } {
  const sessionId = crypto.randomUUID();
  const home = process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
  const slug = session.cwd.replace(/[^a-zA-Z0-9._-]/g, "-");
  const directory = path.join(home, "projects", slug);
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${sessionId}.jsonl`);
  const records: ClaudeRecord[] = [];
  let parentUuid: string | null = null;
  for (const turn of session.turns) {
    const base = () => ({ uuid: crypto.randomUUID(), parentUuid, isSidechain: false,
      timestamp: turn.timestamp, sessionId, cwd: session.cwd, gitBranch: session.gitBranch });
    const append = (record: ClaudeRecord) => { records.push(record); parentUuid = record.uuid; };
    append({ ...base(), type: "user", message: { role: "user", content: turn.userMessage } });
    // Index-based IDs remain distinct even for parallel calls with the same name/time.
    const ids = turn.toolCalls.map(() => crypto.randomUUID());
    for (const event of historyEvents(turn)) {
      if (event.type === "tool_result") {
        const call = turn.toolCalls[event.callIndex];
        if (call.output !== undefined) append({ ...base(), type: "user", message: { role: "user",
          content: [{ type: "tool_result", tool_use_id: ids[event.callIndex], content: call.output }] } });
        continue;
      }
      let block: ClaudeContentBlock;
      if (event.type === "assistant") {
        block = { type: "text", text: event.text };
      } else {
        const call = turn.toolCalls[event.callIndex];
        let input: Record<string, unknown>;
        try { input = JSON.parse(call.arguments); } catch { input = { raw: call.arguments }; }
        if (call.toolName === "exec_command") input = { ...input, command: input.cmd || input.command || "" };
        block = { type: "tool_use", id: ids[event.callIndex],
          name: TOOL_NAME_MAP[call.toolName] || call.toolName, input };
      }
      append({ ...base(), type: "assistant", message: { id: `msg_${crypto.randomUUID()}`,
        type: "message", role: "assistant", model: session.model, content: [block],
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
    }
  }
  fs.writeFileSync(filePath, records.map(record => JSON.stringify(record)).join("\n") + "\n", { mode: 0o600 });
  return { sessionId, filePath };
}
