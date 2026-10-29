// ============================================================
// codex-parser.ts - 解析 Codex JSONL 会话
// ============================================================

import fs from "fs";
import readline from "readline";
import type {
  CodexRecord,
  CodexSessionMeta,
  CodexResponseItem,
  CodexEventMsg,
  CodexTurnContext,
  ParsedSession,
  ParsedTurn,
  ParsedToolCall,
} from "./types.js";

/**
 * 解析 Codex JSONL 文件为结构化会话
 */
export async function parseCodexSession(
  filePath: string
): Promise<ParsedSession> {
  const session: ParsedSession = {
    sessionId: "",
    cwd: "",
    model: "",
    startTime: "",
    endTime: "",
    turns: [],
    filesChanged: [],
  };

  let currentTurn: ParsedTurn | null = null;
  let pendingUserSource: "event" | "response" | null = null;
  let pendingUserText = "";
  let pendingToolCallMap = new Map<string, ParsedToolCall>();
  const fileSet = new Set<string>();

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: CodexRecord;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    switch (record.type) {
      case "session_meta": {
        const meta = record as CodexSessionMeta;
        session.sessionId = meta.payload.id;
        session.cwd = meta.payload.cwd;
        session.startTime = record.timestamp;
        if (meta.payload.git) {
          session.gitBranch = meta.payload.git.branch;
          session.gitCommitHash = meta.payload.git.commit_hash;
        }
        break;
      }

      case "turn_context": {
        const tc = record as CodexTurnContext;
        if (tc.payload.model) {
          session.model = tc.payload.model;
        }
        break;
      }

      case "event_msg": {
        const em = record as CodexEventMsg;
        const pType = em.payload.type;

        if (pType === "user_message") {
          const text = (em.payload.message || "").trim();
          if (pendingUserSource === "response" && pendingUserText === text) {
            pendingUserSource = null;
            break;
          }
          pendingUserSource = "event";
          pendingUserText = text;
          // 新 turn 开始
          if (currentTurn) {
            flushTurn(currentTurn, session, pendingToolCallMap);
          }
          currentTurn = {
            index: session.turns.length,
            userMessage: em.payload.message || "",
            timestamp: em.timestamp,
            assistantMessages: [],
            toolCalls: [],
            reasoningCount: 0,
            events: [],
          };
          session.endTime = em.timestamp;
        } else if (pType === "agent_message" || pType === "task_complete" || pType === "task_completed") {
          pendingUserSource = null;
        }
        break;
      }

      case "response_item": {
        const ri = record as CodexResponseItem;

        // Codex >= 0.15x no longer emits event_msg/user_message. The user turn
        // arrives as a response_item message with role "user" instead.
        if (ri.payload.type === "message" && ri.payload.role === "user") {
          const userText = (ri.payload.content || [])
            .filter((b) => b.text)
            .map((b) => b.text)
            .join("\n")
            .trim();
          if (!userText || userText.startsWith("<environment_context>")) {
            break;
          }
          // Legacy sessions have UI/API copies in either order. Pair only
          // opposite representations before any assistant/tool activity.
          const duplicateLegacy: boolean = pendingUserSource === "event" && pendingUserText === userText;
          pendingUserSource = duplicateLegacy ? null : "response";
          pendingUserText = userText;
          if (!duplicateLegacy || !currentTurn) {
            if (currentTurn) {
              flushTurn(currentTurn, session, pendingToolCallMap);
            }
            currentTurn = {
              index: session.turns.length,
              userMessage: userText,
              timestamp: ri.timestamp,
              assistantMessages: [],
              toolCalls: [],
              reasoningCount: 0,
              events: [],
            };
            session.endTime = ri.timestamp;
          }
          break;
        }

        pendingUserSource = null;
        if (!currentTurn) break;

        switch (ri.payload.type) {
          case "message": {
            if (ri.payload.role === "assistant" && ri.payload.content) {
              const text = ri.payload.content
                .filter((b) => b.type === "output_text" && b.text)
                .map((b) => b.text)
                .join("\n");
              if (text) {
                currentTurn.assistantMessages.push(text);
                currentTurn.events?.push({ type: "assistant", text });
              }
            }
            break;
          }

          case "function_call": {
            const tc: ParsedToolCall = {
              toolName: ri.payload.name || "unknown",
              arguments: ri.payload.arguments || "{}",
              timestamp: ri.timestamp,
            };
            currentTurn.toolCalls.push(tc);
            currentTurn.events?.push({ type: "tool_call", callIndex: currentTurn.toolCalls.length - 1 });
            if (ri.payload.call_id) {
              pendingToolCallMap.set(ri.payload.call_id, tc);
            }
            break;
          }

          case "function_call_output": {
            if (ri.payload.call_id && pendingToolCallMap.has(ri.payload.call_id)) {
              const tc = pendingToolCallMap.get(ri.payload.call_id)!;
              tc.output = typeof ri.payload.output === "string" ? ri.payload.output : JSON.stringify(ri.payload.output ?? "");
              currentTurn.events?.push({ type: "tool_result", callIndex: currentTurn.toolCalls.indexOf(tc) });
              pendingToolCallMap.delete(ri.payload.call_id);
            }
            break;
          }

          case "custom_tool_call": {
            const tc: ParsedToolCall = {
              toolName: ri.payload.name || "custom",
              arguments: ri.payload.input || "",
              timestamp: ri.timestamp,
            };
            currentTurn.toolCalls.push(tc);
            currentTurn.events?.push({ type: "tool_call", callIndex: currentTurn.toolCalls.length - 1 });
            if (ri.payload.call_id) {
              pendingToolCallMap.set(ri.payload.call_id, tc);
            }
            break;
          }

          case "custom_tool_call_output": {
            if (ri.payload.call_id && pendingToolCallMap.has(ri.payload.call_id)) {
              const tc = pendingToolCallMap.get(ri.payload.call_id)!;
              tc.output = typeof ri.payload.output === "string" ? ri.payload.output : JSON.stringify(ri.payload.output ?? "");
              currentTurn.events?.push({ type: "tool_result", callIndex: currentTurn.toolCalls.indexOf(tc) });
              pendingToolCallMap.delete(ri.payload.call_id);
            }
            break;
          }

          case "reasoning": {
            currentTurn.reasoningCount++;
            for (const block of ri.payload.summary || []) {
              if (block.text) {
                const text = "[Source reasoning summary retained as historical text]\n" + block.text;
                currentTurn.assistantMessages.push(text);
                currentTurn.events?.push({ type: "assistant", text });
              }
            }
            break;
          }
        }
        break;
      }
    }
  }

  // flush 最后一个 turn
  if (currentTurn) {
    flushTurn(currentTurn, session, pendingToolCallMap);
  }

  // 从工具调用中提取变更的文件
  extractChangedFiles(session);

  return session;
}

function flushTurn(
  turn: ParsedTurn,
  session: ParsedSession,
  pendingToolCallMap: Map<string, ParsedToolCall>
) {
  // Calls are retained at their original position, even without a result.
  pendingToolCallMap.clear();
  session.turns.push(turn);
}

/**
 * 从工具调用参数和 apply_patch 内容中提取变更的文件
 */
function extractChangedFiles(session: ParsedSession): void {
  const fileSet = new Set<string>();

  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      // apply_patch 中包含文件路径
      if (tc.toolName === "apply_patch") {
        const patchContent = tc.arguments;
        const matches = patchContent.matchAll(
          /\*\*\s*(?:Add|Delete|Update|Move|Rename)\s*File:\s*(.+)/g
        );
        for (const m of matches) {
          fileSet.add(m[1].trim());
        }
      }

      // exec_command 中可能有文件路径
      if (tc.toolName === "exec_command") {
        try {
          const args = JSON.parse(tc.arguments);
          // 提取常见的文件操作命令中的文件名
          const cmd = args.cmd || "";
          const writePatterns = [
            />\s*([^\s&|;]+)/g,          // echo > file
            /tee\s+([^\s]+)/g,            // tee file
            /cat\s*>\s*([^\s]+)/g,        // cat > file
          ];
          for (const pat of writePatterns) {
            const m = cmd.matchAll(pat);
            for (const match of m) {
              const f = match[1];
              if (!f.startsWith("-") && f.includes(".")) {
                fileSet.add(f);
              }
            }
          }
        } catch {
          // skip
        }
      }
    }
  }

  session.filesChanged = Array.from(fileSet);
}
