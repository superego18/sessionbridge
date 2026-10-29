# Client compatibility

**Record exact versions and the evidence level. A newer version is unverified,
not automatically supported.** These results describe fork 1.4.1 as checked on
2026-10-29. They are not a minimum/maximum supported-version range.

| Client/runtime | Exact version | Platform | Verified | Not verified |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.312 | Windows x64 | Local marketplace install, in-place source registration, disabling the old plugin, repeat installation, manifest validation | Cold resume of a converted Claude conversation; first model response |
| Codex CLI | 0.163.0 | Windows x64 | Synthetic export, native migration, thread list, native history read, title | Interactive cold resume; first model response |
| Codex application-bundled binary | 0.165.0 | Windows x64 | Same isolated native probe: export, migration, thread list, history read, title | Interactive cold resume; first model response |
| Node.js | 24.19.0 | Windows x64 | Regression tests, native SQLite dependency, TypeScript build | Other Node major versions |
| Node.js | 24.x | GitHub Windows/macOS runners | Clean dependency install, seven regression tests, TypeScript build | Claude/Codex native client behavior on macOS |

The application-bundled Codex server and the shell's Codex CLI may have
different versions. Probe the actual binary that will read the imported history.

## Repeatable Codex check

```bash
npm ci
npm test
npm run build
npm run test:native -- /absolute/path/to/codex
```

The native probe creates a temporary CODEX_HOME, writes synthetic messages,
uses the installed client's migration and app-server APIs, stops its isolated
daemon, then removes only its own temporary files. If Windows retains a file
lock, it prints the retained synthetic profile path for later cleanup.
It does not read existing conversations, copy login
credentials, trust a regular project profile, or send a model request.

## Release checklist

1. Record `claude --version`, `codex --version` and `node --version` for each
   machine. Record an application-bundled binary separately if it differs.
2. Run the unit/build checks and native probe against each Codex version to
   be claimed. A failing or unknown native schema remains unverified.
3. Check plugin installation and source path with the exact Claude version.
   Record an interactive resume/model-response check separately when performed.
4. Update this table with exact versions, date, platform and evidence. Preserve
   old evidence as historical entries rather than extending a version range.
5. Commit the fork change and update the parent submodule pointer. Native probe
   failures require investigation before that client version is claimed.

## Known boundaries

- The reader handles both legacy `event_msg/user_message` and modern
  `response_item/message` user records. This is a format claim covered by
  fixtures, not evidence that every client release has been exercised.
- `migrate-rollouts` and the app-server fields used by the probe are
  version-sensitive. Native history readability does not prove that provider
  permissions, reasoning records or a subsequent model turn will succeed.
- Default context injection truncates strings. No tested version makes that
  mode lossless, and existing code/working-tree changes are not transferred.
