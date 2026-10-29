import fs from "fs";
import path from "path";
import crypto from "crypto";

// The conversion reads this immutable snapshot, not a source that may grow.
export function archiveSource(filePath: string, source: "claude" | "codex", targetHome: string) {
  const bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const directory = path.join(targetHome, "sessionbridge-archives", `${source}-${sha256}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sourcePath = path.join(directory, "source.jsonl");
  if (!fs.existsSync(sourcePath)) fs.writeFileSync(sourcePath, bytes, { mode: 0o600, flag: "wx" });
  const storedHash = crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  if (storedHash !== sha256) throw new Error(`Source archive checksum mismatch: ${sourcePath}`);
  const manifestPath = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({ source, originalPath: path.resolve(filePath),
      sha256, bytes: bytes.length, capturedAt: new Date().toISOString(),
      scope: "Exact source JSONL only. External files and other session files are not copied.",
    }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  }
  return { directory, sourcePath, sha256 };
}
