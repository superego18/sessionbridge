# Verified version combinations

**Track the fork, Claude Code and Codex versions together.** The machine-readable
source is [compatibility.json](compatibility.json). Each entry also records the
platform, date, Node version, exact checks and a fingerprint of the tested source.
A newer client is unverified; these are exact combinations, not a support range.

<!-- version-combinations:start -->
| Fork | Claude Code | Codex | Platform | Checked | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1.4.1 | 2.1.312 | 0.163.0 | win32-x64 | 2026-10-29 | historical |
| 1.4.1 | 2.1.312 | 0.165.0 | win32-x64 | 2026-10-29 | historical |
| 1.4.2 | 2.1.312 | 0.163.0 | win32-x64 | 2026-10-29 | historical |
| 1.4.2 | 2.1.312 | 0.165.0 | win32-x64 | 2026-10-29 | historical |
| 1.4.3 | 2.1.312 | 0.163.0 | win32-x64 | 2026-10-29 | verified |
| 1.4.3 | 2.1.312 | 0.165.0 | win32-x64 | 2026-10-29 | verified |
<!-- version-combinations:end -->

## What these checks establish

- Claude Code: isolated local marketplace installation and manifest validation.
  Version 1.4.2 and later tuples also cold-resume a converted conversation against a local
  fixture provider, inspect the full message/tool history in the native request,
  verify a Claude model is selected, and receive a simulated streaming response.
  Historical 1.4.1 tuples only checked installation; see each JSON entry's checks.
- Codex: synthetic export, native migration, thread list, native history read and
  title retention. Version 1.4.2 and later probes also check long text and tool output.
- Version 1.4.3 probes verify that unfinished source calls remain labelled
  history with an unknown outcome, without an orphan native tool call.
- **No external model request is sent. A real model response and source permissions,
  encrypted reasoning, images, external files and separate sessions are not
  claimed to be portable.** Source JSONL archives preserve their original bytes.
- Windows/macOS CI checks dependency installation, conversion fixtures and build.
  It does not prove native client compatibility on macOS.

## Verify and record a combination

```bash
npm ci
npm test
npm run build
npm run test:native -- /path/to/codex /path/to/claude --record
npm run check:compatibility
```

The probe creates isolated Codex and Claude homes and uses synthetic records only.
Claude's resume probe uses a dummy API key, removes inherited OAuth/auth tokens,
disables nonessential traffic and points the provider to 127.0.0.1. No recorded
conversation or real authentication file is copied into either probe home.
It records a tuple only after all native checks pass, then regenerates the table
above. `check:compatibility` rejects mismatched package/plugin/marketplace versions
and source changes without a matching verified tuple. It does not block ordinary
migration commands at runtime. Verify every client version you intend to claim;
the shell CLI and application-bundled binary may differ.

The probe stops its own Codex daemon. If Windows retains a file lock, the synthetic
temporary profile is kept and its path is printed for later cleanup. It never
copies regular authentication files or restores native permission settings.

## Update procedure

1. Bump the fork version in package, lockfile, plugin and marketplace metadata,
   plus `currentForkVersion` in compatibility.json.
2. Run regression/build checks, then probe each exact Claude/Codex pair with
   `--record`. Old tuples stay as historical evidence.
3. Review changed preservation boundaries. Run `check:compatibility`, commit the
   fork and update the parent repository's pinned submodule commit.

The source fingerprint normalizes CRLF/LF so it is stable across both machines.
Do not infer an untested version interval from two successful version endpoints.
