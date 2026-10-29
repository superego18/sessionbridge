import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { parseCodexSession } from '../src/codex-parser.js';
import { parseClaudeSession } from '../src/claude-reader.js';

const timestamp = '2026-01-01T00:00:00.000Z';
const user = (text: string) => ({ timestamp, type: 'response_item', payload: {
  type: 'message', role: 'user', content: [{ type: 'input_text', text }],
} });
const assistant = { timestamp, type: 'response_item', payload: {
  type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }],
} };

function fixture(t: TestContext, records: unknown[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionbridge-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  return { dir, file };
}

test('modern Codex user records are imported, environment-only records are excluded', async t => {
  const { file } = fixture(t, [user('<environment_context>metadata</environment_context>'), user('한글 질문'), assistant]);
  const parsed = await parseCodexSession(file);
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].userMessage, '한글 질문');
  assert.deepEqual(parsed.turns[0].assistantMessages, ['done']);
});

test('legacy UI and API copies of one user message create one turn', async t => {
  const { file } = fixture(t, [
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'hello' } },
    user('hello'), assistant,
  ]);
  assert.equal((await parseCodexSession(file)).turns.length, 1);
});

test('identical prompts after an answer remain separate conversation turns', async t => {
  const { file } = fixture(t, [user('continue'), assistant, user('continue'), assistant]);
  const parsed = await parseCodexSession(file);
  assert.equal(parsed.turns.length, 2);
  assert.deepEqual(parsed.turns.map(turn => turn.assistantMessages), [['done'], ['done']]);
});

test('legacy API then UI copies of the same user message create one turn', async t => {
  const { file } = fixture(t, [user('hello'),
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }, assistant]);
  const parsed = await parseCodexSession(file);
  assert.equal(parsed.turns.length, 1);
  assert.deepEqual(parsed.turns[0].assistantMessages, ['done']);
});

test('a legacy-only prompt cannot consume a later identical modern prompt', async t => {
  const { file } = fixture(t, [
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'continue' } },
    assistant, user('continue'), assistant,
  ]);
  assert.equal((await parseCodexSession(file)).turns.length, 2);
});

test('the latest Claude custom title is carried with the parsed session', async t => {
  const { file } = fixture(t, [
    { type: 'custom-title', customTitle: 'Old title' },
    { type: 'user', sessionId: 'fixture', cwd: '/fixture', timestamp, message: { content: 'hello' } },
    { type: 'custom-title', customTitle: 'Current title' },
  ]);
  assert.equal((await parseClaudeSession(file)).title, 'Current title');
});

test('Codex export uses target config, seconds, provider and the carried title', t => {
  const { dir } = fixture(t, []);
  fs.writeFileSync(path.join(dir, 'config.toml'), 'model = "target-model"\n[profiles.other]\nmodel = "wrong-model"\n');
  const db = new Database(path.join(dir, 'state_5.sqlite'));
  db.exec(`CREATE TABLE threads (
    id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER,
    source TEXT, model_provider TEXT, cwd TEXT, title TEXT, sandbox_policy TEXT,
    approval_mode TEXT, tokens_used INTEGER, has_user_event INTEGER, archived INTEGER,
    git_branch TEXT, cli_version TEXT, model TEXT, name TEXT
  )`);
  const session = { sessionId: 'fixture', cwd: process.cwd(), model: 'source-claude-model',
    title: 'Current title', startTime: timestamp, endTime: timestamp, filesChanged: [],
    turns: [{ index: 0, timestamp, userMessage: 'hello', assistantMessages: ['done'], toolCalls: [], reasoningCount: 0 }],
  };
  const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import { writeCodexSession } from './src/codex-writer.ts'; console.log(JSON.stringify(writeCodexSession(JSON.parse(process.argv[1]))));",
    JSON.stringify(session)], { cwd: process.cwd(), env: { ...process.env, CODEX_HOME: dir }, encoding: 'utf8' }));
  const records = fs.readFileSync(result.filePath, 'utf8').trim().split('\n').map(JSON.parse);
  const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(result.sessionId) as Record<string, unknown>;
  db.close();
  assert.equal(records[0].payload.model_provider, 'openai');
  assert.equal(records.find(r => r.type === 'turn_context').payload.model, 'target-model');
  assert.equal(row.model, 'target-model');
  assert.equal(row.model_provider, 'openai');
  assert.ok(Number(row.created_at) < 10_000_000_000, 'SQLite timestamps must be Unix seconds');
  assert.equal(row.name, 'Current title(cl->cx)');
  assert.equal(row.cwd, process.platform === 'win32' ? '\\\\?\\' + process.cwd() : process.cwd());
  const index = fs.readFileSync(path.join(dir, 'session_index.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(index.some(entry => entry.id === result.sessionId && entry.thread_name === 'Current title(cl->cx)'));
});
