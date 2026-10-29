// Native resume against a loopback fixture provider; no real model request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';

const binary = process.argv[2];
if (!binary) throw new Error('Usage: node test/claude-native-probe.mjs /path/to/claude');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionbridge-claude-native-'));
const env = { ...process.env, CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ANTHROPIC_API_KEY: 'synthetic-local-key' };
delete env.CLAUDE_CODE_OAUTH_TOKEN;
delete env.ANTHROPIC_AUTH_TOKEN;
const ts = new Date().toISOString();
const user = 'CLAUDE-RESTORE-USER-' + 'U'.repeat(2000);
const answer = 'CLAUDE-RESTORE-ANSWER-' + 'A'.repeat(3000);
const output = 'CLAUDE-RESTORE-TOOL-' + 'T'.repeat(4000);
const session = { sessionId: 'fixture', cwd: process.cwd(), model: 'gpt-source-fixture', startTime: ts, endTime: ts, filesChanged: [],
  turns: [{ index: 0, timestamp: ts, userMessage: user, assistantMessages: [answer], reasoningCount: 0,
    toolCalls: [{ toolName: 'exec_command', timestamp: ts, arguments: '{"cmd":"echo synthetic"}', output }] }] };
const created = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
  "import { writeClaudeSession } from './src/claude-writer.ts'; console.log(JSON.stringify(writeClaudeSession(JSON.parse(process.argv[1]))));",
  JSON.stringify(session)], { env, encoding: 'utf8' }));
const captured = [];
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (request.url.includes('count_tokens')) { response.setHeader('Content-Type', 'application/json'); response.end('{"input_tokens":100}'); return; }
  if (!request.url.includes('messages')) { response.setHeader('Content-Type', 'application/json'); response.end('{}'); return; }
  captured.push(body);
  const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } };
  if (!body.stream) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ...message, content: [{ type: 'text', text: 'LOCAL-FIXTURE-OK' }], stop_reason: 'end_turn' })); return;
  }
  response.setHeader('Content-Type', 'text/event-stream');
  const events = [{ type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LOCAL-FIXTURE-OK' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }, { type: 'message_stop' }];
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, ['--resume', created.sessionId, '--print', 'Continue the local fixture only', '--output-format', 'json', '--max-turns', '1'],
      { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude loopback probe timed out')); }, 45_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('LOCAL-FIXTURE-OK'));
  assert.ok(captured.some(body => {
    const history = JSON.stringify(body.messages);
    return String(body.model).startsWith('claude-') && history.includes(user) && history.includes(answer) && history.includes(output);
  }), 'native resumed request must retain complete history and select a Claude model');
  console.log(JSON.stringify({ claudeConversationResume: true, claudeProvider: 'loopback-fixture', modelResponse: false }));
} finally {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { if (!['EPERM', 'EBUSY'].includes(error.code)) throw error; console.warn(`Synthetic Claude profile retained: ${home}`); }
}
