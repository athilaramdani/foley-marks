import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";

function lines(encoded) {
  return Buffer.from(encoded.trim(), "base64").toString().trim().split(/\r?\n/);
}
export function verifySignature(bytes, encodedSig, encodedKey) {
  const [, keyPacket] = lines(encodedKey);
  const [, sigPacket, commentLine, globalSig] = lines(encodedSig);
  const key = Buffer.from(keyPacket, "base64"),
    signature = Buffer.from(sigPacket, "base64");
  assert.equal(key.length, 42);
  assert.equal(signature.length, 74);
  assert.deepEqual(
    key.subarray(2, 10),
    signature.subarray(2, 10),
    "Signature key ID mismatch",
  );
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const algorithm = signature.subarray(0, 2).toString();
  assert.ok(["Ed", "ED"].includes(algorithm));
  const payload =
    algorithm === "ED"
      ? createHash("blake2b512").update(bytes).digest()
      : bytes;
  assert.ok(
    verify(null, payload, publicKey, signature.subarray(10)),
    "Invalid artifact signature",
  );
  assert.ok(commentLine?.startsWith("trusted comment: "));
  const comment = Buffer.from(commentLine.slice("trusted comment: ".length));
  assert.ok(
    verify(
      null,
      Buffer.concat([signature.subarray(10), comment]),
      publicKey,
      Buffer.from(globalSig, "base64"),
    ),
    "Invalid trusted comment",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [installer, manifest] = process.argv.slice(2);
  const cfg = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json"));
  const bytes = fs.readFileSync(installer),
    sig = fs.readFileSync(installer + ".sig", "utf8").trim();
  verifySignature(bytes, sig, cfg.plugins.updater.pubkey);
  if (manifest) {
    const latest = JSON.parse(fs.readFileSync(manifest));
    assert.equal(latest.version.replace(/^v/, ""), cfg.version);
    const entry =
      latest.platforms["windows-x86_64"] ??
      latest.platforms["windows-x86_64-nsis"];
    assert.equal(entry.signature.trim(), sig);
    assert.equal(
      entry.url,
      "https://github.com/athilaramdani/foley-marks/releases/download/v" +
        cfg.version +
        "/" +
        path.basename(installer),
    );
  }
  console.log("Verified release signature for", path.basename(installer));
}
