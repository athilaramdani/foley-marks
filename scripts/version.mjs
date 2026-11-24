import fs from "node:fs";
import assert from "node:assert/strict";

const [mode, argument] = process.argv.slice(2);
const read = (file) => fs.readFileSync(file, "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const cargo = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const packageVersion = /(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/;
const lockVersion =
  /(\[\[package\]\]\s*name = "foleymarks"\s*version = ")([^"]+)(")/;
const version = pkg.version;
for (const actual of [
  lock.version,
  lock.packages[""].version,
  config.version,
  cargo.match(packageVersion)?.[2],
  cargoLock.match(lockVersion)?.[2],
]) {
  assert.equal(actual, version, "Project version fields must agree");
}
if (mode === "check") {
  if (argument) assert.equal(argument, "v" + version, "Release tag mismatch");
  console.log("Version verified:", version);
} else if (mode === "set") {
  assert.match(argument ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const next = argument.split(".").map(Number),
    current = version.split(".").map(Number);
  const index = next.findIndex((v, i) => v !== current[i]);
  assert.ok(
    index >= 0 && next[index] > current[index],
    "New version must be greater",
  );
  pkg.version =
    lock.version =
    lock.packages[""].version =
    config.version =
      argument;
  for (const [file, value] of [
    ["package.json", pkg],
    ["package-lock.json", lock],
    ["src-tauri/tauri.conf.json", config],
  ]) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  }
  fs.writeFileSync(
    "src-tauri/Cargo.toml",
    cargo.replace(packageVersion, (_, a, b, c) => a + argument + c),
  );
  fs.writeFileSync(
    "src-tauri/Cargo.lock",
    cargoLock.replace(lockVersion, (_, a, b, c) => a + argument + c),
  );
  console.log(
    "Version updated. Review changes and changelog before tagging v" + argument,
  );
} else {
  throw Error("Usage: npm run versioning -- check [vX.Y.Z] | set X.Y.Z");
}
