# Maintained fork

This fork starts at `tongtongtju/sessionbridge` commit
`97cacdd9bb53ddb345c2b552a471494a6e3d41e1` and retains the original attribution.
The fork marketplace is named **sessionbridge-chanju**; the plugin name and
`/sessionbridge:import-session` command stay unchanged.

## 1.4.1

- Accept Codex user messages stored as `response_item` records. Exclude
  environment-only messages and deduplicate legacy UI/API copies without
  merging two separate prompts with identical text.
- Carry the latest Claude custom title into Codex's thread name and index.
- Use the destination Codex home's configured top-level model and the `openai`
  provider, Unix seconds for SQLite timestamps, and Windows extended paths
  when registering Windows working directories.
- Fix the session metadata type narrowing so the TypeScript build passes.
- Add synthetic-fixture regression tests. No real conversations are included.

## Installation and development

Install from a checked-out, pinned copy of this fork:

```bash
claude plugin install sessionbridge --marketplace /path/to/sessionbridge --scope user
```

If the original `sessionbridge@sessionbridge` plugin is installed, disable it
after installing this fork to avoid duplicate slash commands. Updating the
local marketplace uses its checked-out source; update a parent submodule's
pinned commit deliberately and bump the plugin version for a new release.

```bash
npm ci
npm test
npm run build
claude plugin validate .
```

`better-sqlite3` is a native dependency and must be installed or rebuilt on
each operating system and Node ABI. Do not copy `node_modules` between machines.

## Migration boundaries

The default `cx2cl` mode prints a length-limited Markdown projection; it is not
a lossless transcript. `--new-session` writes a converted Claude transcript,
but source reasoning, unsupported records and client-specific state are not
guaranteed to survive. Code and working-tree state are not transferred.

`cl2cx` writes a rollout and a legacy SQLite row. Codex versions that use the
thread history store may also require:

```bash
codex migrate-rollouts --apply --thread <new-session-id>
codex resume <new-session-id>
```

This is a version-sensitive integration with private client storage. Synthetic
tests verify conversion rules, not cold resume in every client release.
