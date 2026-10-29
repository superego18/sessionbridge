import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  const files = ['package.json', ...fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.ts')).sort().map(name => 'src/' + name)];
  for (const file of files) hash.update(file + '\n' + fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n') + '\n');
  return hash.digest('hex');
}

export function recordVerification(root, entry) {
  const file = path.join(root, 'compatibility.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = item => [item.forkVersion, item.claudeVersion, item.codexVersion, item.platform].join('|');
  data.verifications = data.verifications.filter(item => key(item) !== key(entry));
  data.verifications.push(entry);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  renderCompatibility(root, data);
}

function renderCompatibility(root, data) {
  const file = path.join(root, 'COMPATIBILITY.md');
  const fingerprint = sourceFingerprint(root);
  const rows = data.verifications.map(item => {
    const status = item.forkVersion !== data.currentForkVersion ? 'historical'
      : item.sourceSha256 === fingerprint ? 'verified' : 'stale source';
    return `| ${item.forkVersion} | ${item.claudeVersion} | ${item.codexVersion} | ${item.platform} | ${item.checkedAt.slice(0, 10)} | ${status} |`;
  });
  const table = ['<!-- version-combinations:start -->', '| Fork | Claude Code | Codex | Platform | Checked | Evidence |',
    '| --- | --- | --- | --- | --- | --- |', ...rows, '<!-- version-combinations:end -->'].join('\n');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(/<!-- version-combinations:start -->[\s\S]*?<!-- version-combinations:end -->/, table));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const plugin = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const market = JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const data = JSON.parse(fs.readFileSync('compatibility.json', 'utf8'));
  if (process.argv.includes('--render')) renderCompatibility(root, data);
  if ([plugin.version, market.metadata.version, market.plugins[0].version, lock.version, lock.packages[''].version, data.currentForkVersion].some(v => v !== pkg.version)) {
    throw new Error('Fork/package/plugin/marketplace/compatibility versions disagree');
  }
  const sourceSha256 = sourceFingerprint(root);
  if (data.verifications.some(item => item.forkVersion === pkg.version && item.sourceSha256 !== sourceSha256)) {
    throw new Error('A claimed client combination has stale source evidence; rerun every claimed combination.');
  }
  const verified = data.verifications.filter(item => item.forkVersion === pkg.version && item.sourceSha256 === sourceSha256
    && item.claudeVersion && item.codexVersion && item.checks.claudePluginInstall && item.checks.codexMigration
    && item.checks.codexList && item.checks.codexRead && item.checks.codexTitle
    && item.checks.modelResponse === false && item.checks.claudeConversationResume === false);
  if (!verified.length) throw new Error('No verified fork + Claude + Codex combination for this source. Run test:native with --record.');
  console.log(JSON.stringify({ forkVersion: pkg.version, verifiedCombinations: verified.length, sourceSha256 }));
}
