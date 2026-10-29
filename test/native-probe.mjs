// Probe only an isolated synthetic Codex home; never sends a model request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const binary = process.argv[2];
if (!binary) throw new Error('Usage: npm run test:native -- /path/to/codex');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionbridge-native-'));
const env = { ...process.env, CODEX_HOME: home };
let server;
try {
  const version = execFileSync(binary, ['--version'], { env, encoding: 'utf8' }).trim();
  execFileSync(binary, ['migrate-rollouts', '--json'], { env, encoding: 'utf8', stdio: 'pipe' });
  const ts = new Date().toISOString();
  const session = { sessionId: 'fixture', cwd: process.cwd(), title: 'Compatibility fixture',
    model: 'source-claude-model', startTime: ts, endTime: ts, filesChanged: [],
    turns: [{ index: 0, timestamp: ts, userMessage: 'Synthetic hello',
      assistantMessages: ['Synthetic answer'], toolCalls: [], reasoningCount: 0 }],
  };
  const exported = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import { writeCodexSession } from './src/codex-writer.ts'; console.log(JSON.stringify(writeCodexSession(JSON.parse(process.argv[1]))));",
    JSON.stringify(session)], { env, encoding: 'utf8' }));
  const migration = JSON.parse(execFileSync(binary, ['migrate-rollouts', '--apply', '--thread', exported.sessionId, '--json'],
    { env, encoding: 'utf8', stdio: 'pipe' }));
  assert.equal(migration.outcomes.find(item => item.thread_id === exported.sessionId)?.status, 'migrated');
  server = spawn(binary, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  server.stderr.resume();
  const pending = new Map();
  createInterface({ input: server.stdout }).on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const handler = pending.get(response.id);
    if (handler) {
      pending.delete(response.id);
      clearTimeout(handler.timer);
      response.error ? handler.reject(new Error(JSON.stringify(response.error))) : handler.resolve(response.result);
    }
  });
  const request = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    server.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await request(1, 'initialize', { clientInfo: { name: 'sessionbridge-probe', version: '1.0' }, capabilities: { experimentalApi: true } });
  const listing = await request(2, 'thread/list', { limit: 10 });
  const thread = listing.data.find(item => item.id === exported.sessionId);
  assert.ok(thread, 'converted session must appear in native thread/list');
  assert.equal(thread.name, 'Compatibility fixture(cl->cx)');
  const read = await request(3, 'thread/read', { threadId: thread.id, includeTurns: true });
  const text = JSON.stringify(read);
  assert.ok(text.includes('Synthetic hello') && text.includes('Synthetic answer'), 'native history must retain both messages');
  console.log(JSON.stringify({ version, migrated: true, listed: true, history: true, name: true, modelRequestSent: false }));
} finally {
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  // The stdio frontend may start a managed daemon. Stop only this test home's
  // daemon before deleting files it can still hold open on Windows.
  execFileSync(binary, ['app-server', 'daemon', 'stop'], { env, encoding: 'utf8', stdio: 'pipe' });
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (!['EPERM', 'EBUSY'].includes(error.code)) throw error;
    console.warn(`Temporary synthetic profile is still locked and was retained: ${home}`);
  }
}
