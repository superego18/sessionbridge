import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseClaudeSession } from '../src/claude-reader.js';
import { parseCodexSession } from '../src/codex-parser.js';
import { buildContextSummary } from '../src/context-builder.js';

const ts = '2026-01-01T00:00:00.000Z';
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionbridge-fidelity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root: string, records: unknown[]) {
  const file = path.join(root, 'source.jsonl');
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
function runWriter(root: string, direction: string, session: unknown) {
  const [file, name] = direction === 'claude' ? ['claude-writer', 'writeClaudeSession'] : ['codex-writer', 'writeCodexSession'];
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import { ${name} } from './src/${file}.ts'; console.log(JSON.stringify(${name}(JSON.parse(process.argv[1]))));`,
    JSON.stringify(session)], { encoding: 'utf8', env: { ...process.env, CLAUDE_HOME: root,
      CLAUDE_CONFIG_DIR: root, CODEX_HOME: root } }));
}

test('context injection retains long messages, nested tool arguments and complete outputs', () => {
  const user = 'user-' + '가'.repeat(2000) + '-USER-END';
  const answer = 'answer-' + '나'.repeat(3000) + '-ANSWER-END';
  const output = 'output-' + '다'.repeat(4000) + '-OUTPUT-END';
  const args = { a: 1, b: 2, c: 3, nested: { keep: 'fourth-argument' } };
  const context = buildContextSummary({ sessionId: 'fixture', cwd: '/fixture', model: 'fixture',
    startTime: ts, endTime: ts, filesChanged: [], turns: [{ index: 0, timestamp: ts,
      userMessage: user, assistantMessages: [answer], reasoningCount: 0,
      toolCalls: [{ toolName: 'fixture-tool', arguments: JSON.stringify(args), output, timestamp: ts }] }] });
  for (const value of [user, answer, output, 'fourth-argument']) assert.ok(context.includes(value));
  assert.ok(!context.includes('[object Object]'));
});

test('Claude text blocks and structured tool results survive conversion to Codex', async t => {
  const root = fixture(t);
  const source = write(root, [
    { type: 'user', sessionId: 'fixture', cwd: root, timestamp: ts, message: { content: [{ type: 'text', text: 'block user' }] } },
    { type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo fixture' } }] } },
    { type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'structured result' }] }] } },
  ]);
  const parsed = await parseClaudeSession(source);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].userMessage, 'block user');
  const result = runWriter(root, 'codex', parsed);
  const restored = await parseCodexSession(result.filePath);
  assert.ok(restored.turns[0].toolCalls[0].output?.includes('structured result'));
});

test('same-name same-time tool calls retain distinct results in Claude', async t => {
  const root = fixture(t);
  const session = { sessionId: 'fixture', cwd: root, model: 'fixture', startTime: ts, endTime: ts,
    filesChanged: [], turns: [{ index: 0, timestamp: ts, userMessage: 'hello', assistantMessages: [], reasoningCount: 0,
      toolCalls: ['FIRST', 'SECOND'].map(output => ({ toolName: 'exec_command', timestamp: ts,
        arguments: JSON.stringify({ cmd: 'echo ' + output }), output })) }] };
  const result = runWriter(root, 'claude', session);
  assert.ok(path.resolve(result.filePath).startsWith(path.resolve(root) + path.sep), 'must respect isolated CLAUDE_CONFIG_DIR');
  const restored = await parseClaudeSession(result.filePath);
  assert.deepEqual(restored.turns[0].toolCalls.map(call => call.output), ['FIRST', 'SECOND']);
});

test('a tool result followed by user text stays attached to its original turn', async t => {
  const root = fixture(t);
  const source = write(root, [
    { type: 'user', sessionId: 'fixture', cwd: root, timestamp: ts, message: { content: 'request' } },
    { type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 'one', name: 'Bash', input: { command: 'echo fixture' } }] } },
    { type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: 'one', content: 'result' }, { type: 'text', text: 'follow-up' }] } },
  ]);
  const parsed = await parseClaudeSession(source);
  assert.equal(parsed.turns.length, 2);
  assert.deepEqual(parsed.turns[0].events?.map(event => event.type), ['tool_call', 'tool_result']);
  const context = buildContextSummary(parsed);
  assert.ok(context.indexOf('result') < context.indexOf('follow-up'));
  const result = runWriter(root, 'codex', parsed);
  assert.equal((await parseCodexSession(result.filePath)).turns[0].toolCalls[0].output, 'result');
});

test('git branch metadata survives a cross-client round trip', async t => {
  const root = fixture(t);
  const session = { sessionId: 'fixture', cwd: root, model: 'fixture', gitBranch: 'fixture-branch',
    startTime: ts, endTime: ts, filesChanged: [], turns: [{ index: 0, timestamp: ts,
      userMessage: 'hello', assistantMessages: ['answer'], toolCalls: [], reasoningCount: 0 }] };
  const claude = runWriter(root, 'claude', session);
  const codex = runWriter(root, 'codex', await parseClaudeSession(claude.filePath));
  assert.equal((await parseCodexSession(codex.filePath)).gitBranch, 'fixture-branch');
});

test('assistant/tool/result chronology survives a Codex to Claude to Codex round trip', async t => {
  const root = fixture(t);
  const source = write(root, [
    { timestamp: ts, type: 'session_meta', payload: { id: 'fixture', cwd: root } },
    { timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    { timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'before tool' }] } },
    { timestamp: ts, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'one', arguments: '{"cmd":"echo fixture"}' } },
    { timestamp: ts, type: 'response_item', payload: { type: 'function_call_output', call_id: 'one', output: 'tool result' } },
    { timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'after tool' }] } },
  ]);
  const claude = runWriter(root, 'claude', await parseCodexSession(source));
  const codex = runWriter(root, 'codex', await parseClaudeSession(claude.filePath));
  const records = fs.readFileSync(codex.filePath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const order = records.filter(r => r.type === 'response_item' && r.payload.role !== 'user').map(r =>
    r.payload.type === 'message' ? r.payload.content[0].text : r.payload.type);
  assert.deepEqual(order, ['before tool', 'function_call', 'function_call_output', 'after tool']);
});

test('plaintext source thinking is retained as labelled history, never fabricated ciphertext', async t => {
  const root = fixture(t);
  const source = write(root, [
    { type: 'user', sessionId: 'fixture', cwd: root, timestamp: ts, message: { content: 'hello' } },
    { type: 'assistant', timestamp: ts, message: { content: [{ type: 'thinking', thinking: 'synthetic source reasoning' }, { type: 'text', text: 'answer' }] } },
  ]);
  const result = runWriter(root, 'codex', await parseClaudeSession(source));
  const encoded = fs.readFileSync(result.filePath, 'utf8');
  assert.ok(encoded.includes('synthetic source reasoning'));
  assert.ok(!encoded.includes('encrypted_content'), 'cannot invent portable encrypted reasoning');
});

for (const direction of ['cl2cx', 'cx2cl']) {
  test(`${direction} archives exact source bytes and SHA-256 before projecting`, t => {
    const root = fixture(t);
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const dir = direction === 'cl2cx' ? path.join(root, 'projects', 'fixture') : path.join(root, 'sessions', '2026', '01', '01');
    fs.mkdirSync(dir, { recursive: true });
    const source = path.join(dir, direction === 'cl2cx' ? sourceId + '.jsonl' : 'rollout-' + sourceId + '.jsonl');
    const records = direction === 'cl2cx' ? [
      { type: 'user', sessionId: sourceId, cwd: root, timestamp: ts, message: { content: 'hello' } },
      { type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'answer' }] } },
    ] : [
      { timestamp: ts, type: 'session_meta', payload: { id: sourceId, cwd: root } },
      { timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } },
    ];
    const bytes = Buffer.from(records.concat([{ type: 'unknown_future_record', payload: { encrypted: 'fixture-ciphertext', image: 'fixture-image' } }]).map(r => JSON.stringify(r)).join('\r\n') + '\r\n');
    fs.writeFileSync(source, bytes);
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'src/index.ts', direction, sourceId, '--inject'],
      { encoding: 'utf8', env: { ...process.env, CLAUDE_HOME: root, CLAUDE_CONFIG_DIR: root, CODEX_HOME: root } });
    const archives = path.join(root, 'sessionbridge-archives');
    assert.ok(fs.existsSync(archives), 'an archive must exist even for text injection');
    const entry = path.join(archives, fs.readdirSync(archives)[0]);
    assert.deepEqual(fs.readFileSync(path.join(entry, 'source.jsonl')), bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(entry, 'manifest.json'), 'utf8'));
    assert.equal(manifest.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.ok(output.includes(entry));
    assert.ok(fs.readFileSync(path.join(entry, 'context.md'), 'utf8').includes('hello'));
    assert.deepEqual(fs.readFileSync(source), bytes, 'source must remain unchanged');
  });
}
