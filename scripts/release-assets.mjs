import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifySignature } from "./verify-update.mjs";

const directory = process.argv[2] ?? "artifacts";
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
const installer = "FoleyMarks_" + config.version + "_x64-setup.exe";
const files = [
  installer,
  installer + ".sig",
  "latest.json",
  "media-sources.zip",
];
const read = (name) => fs.readFileSync(path.join(directory, name));
const sig = read(installer + ".sig")
  .toString()
  .trim();
verifySignature(read(installer), sig, config.plugins.updater.pubkey);
const manifestPath = path.join(directory, "latest.json");
const existing = fs.existsSync(manifestPath)
  ? JSON.parse(read("latest.json"))
  : null;
if (existing) assert.equal(existing.version.replace(/^v/, ""), config.version);
const platform = {
  url:
    "https://github.com/athilaramdani/foley-marks/releases/download/v" +
    config.version +
    "/" +
    installer,
  signature: sig,
};
const manifest = {
  version: config.version,
  notes:
    existing?.notes ||
    fs.readFileSync("CHANGELOG.md", "utf8").split(/^## /m)[1]?.trim() ||
    "",
  pub_date: existing?.pub_date || new Date().toISOString(),
  platforms: { "windows-x86_64": platform, "windows-x86_64-nsis": platform },
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(
  path.join(directory, "SHA256SUMS.txt"),
  files
    .map(
      (name) =>
        createHash("sha256").update(read(name)).digest("hex") + "  " + name,
    )
    .join("\n") + "\n",
);
console.log(
  "Verified updater signature, manifest and checksums for " + installer,
);
