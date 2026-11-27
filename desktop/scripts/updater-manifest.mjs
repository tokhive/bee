#!/usr/bin/env node
// Writes the update manifest (latest.json) the app's updater reads, from the
// entries scripts/package-macos.sh writes for each architecture:
//
//   node scripts/updater-manifest.mjs --version 1.2.3 --base-url <url> [--notes <file>] \
//     out/macos-aarch64/darwin-aarch64.json out/macos-x64/darwin-x86_64.json > latest.json
//
// The base URL is where the update archives are published, e.g.
// https://github.com/tokhive/bee/releases/download/desktop-v1.2.3. An entry's
// file name is its platform key.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { version: { type: "string" }, "base-url": { type: "string" }, notes: { type: "string" } },
  allowPositionals: true,
});
const fail = (message) => {
  console.error(`updater-manifest: ${message}`);
  process.exit(2);
};
const version = values.version ?? fail("--version is required");
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version must be major.minor.patch, got ${version}`);
const base = (values["base-url"] ?? fail("--base-url is required")).replace(/\/$/, "");
if (positionals.length === 0) fail("no platform entries");

const platforms = {};
for (const path of positionals) {
  const platform = basename(path, ".json");
  if (!/^(darwin|linux|windows)-(aarch64|x86_64|i686|armv7)$/.test(platform)) fail(`${path}: not a platform entry`);
  const entry = JSON.parse(readFileSync(path, "utf8"));
  if (!entry.signature || !entry.file) fail(`${path}: needs signature and file`);
  // The signature's trusted comment names the version it was signed for; the
  // app refuses a manifest that pairs it with another.
  const comment = Buffer.from(entry.signature, "base64").toString("utf8");
  if (!comment.includes(`version:${version}`)) fail(`${path}: signed for another version`);
  if (!entry.file.includes(`_${version}_`)) fail(`${path}: ${entry.file} is not version ${version}`);
  platforms[platform] = { signature: entry.signature, url: `${base}/${encodeURIComponent(entry.file)}` };
}

const notes = values.notes ? readFileSync(values.notes, "utf8").trim() : "";
process.stdout.write(JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2) + "\n");
