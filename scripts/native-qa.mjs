// Run with npm dependencies installed and a FoleyMarks executable built with its adjacent resources.
// Example: node scripts/native-qa.mjs src-tauri/target/release/foleymarks.exe
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";

const exe = path.resolve(
  process.argv[2] ?? "src-tauri/target/release/foleymarks.exe",
);
const tool = path.join(path.dirname(exe), "ffmpeg.exe");
const id = "FoleyMarks QA café " + crypto.randomUUID();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "foleymarks-webview-"));
const port = 19474;
const paths = [];
let browser;
let app;
let page;
let touchedRecovery = false;
const evidence = [];
function passed(name) {
  evidence.push(name);
  console.log("PASS", name);
}
const call = (name, args = {}) =>
  page.evaluate(
    ([cmd, data]) => window.__TAURI_INTERNALS__.invoke(cmd, data),
    [name, args],
  );
const synthetic = (args, input) =>
  execFileSync(
    tool,
    ["-hide_banner", "-loglevel", "error", "-nostdin", ...args],
    { input, windowsHide: true, timeout: 30000 },
  );
async function ownFolder(base) {
  const folder = path.join(base, id);
  await fs.mkdir(folder);
  paths.push(folder);
  return folder;
}
try {
  await fs.access(exe);
  await fs.access(tool);
  app = spawn(exe, [], {
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=" +
        port +
        " --autoplay-policy=no-user-gesture-required",
    },
  });
  for (let i = 0; i < 60 && !browser; i++) {
    if (app.exitCode !== null) throw Error("Desktop exited during startup");
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:" + port, {
        timeout: 1000,
      });
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  assert.ok(browser, "WebView2 test endpoint");
  const context = browser.contexts()[0];
  page =
    context.pages().find((p) => p.url().includes("tauri.localhost")) ??
    context.pages()[0] ??
    (await context.waitForEvent("page"));
  await page.waitForFunction(
    () => document.querySelector("#root")?.innerText.trim().length > 40,
  );
  const settings = await call("get_settings");
  assert.ok(settings.datasetRoot);
  assert.deepEqual(await call("save_settings", { settings }), settings);
  passed("Desktop startup and native settings round trip");
  const videos = await ownFolder(settings.videoDir);
  const sounds = await ownFolder(settings.soundDir);
  const projects = await ownFolder(settings.projectDir);
  const video = path.join(videos, "picture.mp4");
  const sound = path.join(sounds, "tone.wav");
  const frameSize = 160 * 96 * 3;
  const frames = Buffer.alloc(frameSize * 48);
  for (let f = 0; f < 48; f++) {
    const x = (f * 4) % 120;
    for (let y = 26; y < 66; y++)
      frames.fill(
        230,
        f * frameSize + (y * 160 + x) * 3,
        f * frameSize + (y * 160 + x + 34) * 3,
      );
  }
  synthetic(
    [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      "160x96",
      "-r",
      "24",
      "-i",
      "pipe:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    frames,
  );
  const tone = Buffer.alloc(48000 * 2 * 0.55);
  for (let n = 0; n < tone.length / 2; n++)
    tone.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 520 * n) / 48000) * 4096),
      n * 2,
    );
  synthetic(
    [
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-c:a",
      "pcm_s16le",
      sound,
    ],
    tone,
  );
  const projectFile = path.join(projects, "metadata.json");
  const legacy = {
    schema_version: 1,
    video_path: video,
    annotations: [{ timestamp: 0.5, sound_name: "tone.wav", file_path: sound }],
    custom_qa_note: "keep",
  };
  await fs.writeFile(projectFile, JSON.stringify(legacy));
  const index = await call("scan_dataset");
  assert.ok(index.videos.some((v) => v.path === video));
  assert.ok(index.sounds.some((v) => v.path === sound));
  assert.ok(index.annotations.some((v) => v.path === projectFile));
  passed("Unicode path discovery, video, SFX and metadata");
  const info = await call("probe_media", { path: video });
  assert.equal(info.fps, 24);
  assert.ok(Math.abs(info.duration - 2) < 0.05);
  const peaks = await call("waveform", { path: sound });
  assert.ok(peaks.length > 0 && peaks.some((v) => v > 0));
  assert.deepEqual(await call("waveform", { path: sound }), peaks);
  passed("Packaged FFprobe and waveform generation/cache");
  const media = await call("authorize_media", { path: video });
  await page.evaluate(async (p) => {
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    const ready = new Promise((resolve, reject) => {
      el.onloadeddata = resolve;
      el.onerror = () => reject(Error(el.error?.message ?? "Playback failed"));
    });
    el.src = window.__TAURI_INTERNALS__.convertFileSrc(p);
    document.body.appendChild(el);
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("Media load timed out")), 10000),
        ),
      ]);
      await el.play();
      await new Promise((r) => setTimeout(r, 200));
      if (el.currentTime <= 0) throw Error("Media clock stalled");
      el.pause();
      const sought = new Promise((resolve) => (el.onseeked = resolve));
      el.currentTime = 1.25;
      await Promise.race([
        sought,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("Seek timed out")), 4000),
        ),
      ]);
      if (Math.abs(el.currentTime - 1.25) > 1 / 24)
        throw Error("Media seek missed target");
    } finally {
      el.removeAttribute("src");
      el.load();
      el.remove();
    }
  }, media);
  passed("WebView2 asset playback, pause and seek");
  const project = await call("load_project", { path: projectFile });
  assert.equal(project.schema_version, 3);
  assert.equal(project.custom_qa_note, "keep");
  assert.ok(
    project.tracks.some(
      (t) =>
        t.media_type === "audio" && t.clips.some((c) => c.start_time === 0.5),
    ),
  );
  const v = project.tracks.find((t) => t.media_type === "video");
  const edited = await call("edit_video", {
    project,
    action: "split",
    clipId: v.clips[0].clip_id,
    time: 1,
  });
  assert.equal(
    edited.tracks.find((t) => t.media_type === "video").clips.length,
    2,
  );
  passed(
    "Legacy v1 import, unknown-field preservation and source-offset split",
  );
  const analyzed = await call("run_analysis", {
    project: edited,
    settings: { sample_fps: 4 },
  });
  assert.equal(analyzed.schema_version, 3);
  assert.ok(
    analyzed.tracks
      .find((t) => t.media_type === "audio")
      .clips.some((c) => c.start_time === 0.5),
  );
  passed("Optical flow analysis with manual SFX preservation");
  const annotation = await call("save_annotation", { project: analyzed });
  assert.equal(path.dirname(annotation), settings.annotationDir);
  paths.push(annotation);
  assert.equal(JSON.parse(await fs.readFile(annotation)).schema_version, 3);
  if (!(await call("load_recovery"))) {
    await call("save_recovery", { project: analyzed });
    touchedRecovery = true;
    assert.deepEqual(await call("load_recovery"), analyzed);
    await call("clear_recovery");
    touchedRecovery = false;
    passed("Atomic recovery round trip");
  } else
    console.log("Skipped recovery mutation because a user snapshot exists.");
  const out = await call("export_project", { project: edited });
  assert.equal(path.dirname(out), settings.exportDir);
  assert.match(path.basename(out), /^dataset_export_/);
  paths.push(out);
  const metadata = JSON.parse(
    await fs.readFile(path.join(out, "metadata.json")),
  );
  assert.equal(metadata.rendered_annotations[0].timestamp, 0.5);
  const pcm = execFileSync(
    tool,
    [
      "-v",
      "error",
      "-i",
      path.join(out, "edited.mp4"),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "8000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { windowsHide: true },
  );
  const loud = (start, end) => {
    let max = 0;
    for (let i = Math.floor(start * 8000); i < end * 8000; i++)
      max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
    return max;
  };
  assert.ok(loud(0.05, 0.4) < 150);
  assert.ok(loud(0.55, 0.95) > 300);
  assert.ok(loud(1.2, 1.8) < 150);
  passed(
    "Atomic export bundle, annotation timestamp and decoded SFX onset/end",
  );
  const stranger = path.join(profile, "unselected.mp4");
  await fs.copyFile(video, stranger);
  await assert.rejects(call("authorize_media", { path: stranger }));
  passed("Unselected external media rejected");
  console.log(evidence.length, "native integration checks passed");
} finally {
  if (touchedRecovery && page) await call("clear_recovery").catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (app && app.exitCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
  }
  for (const owned of paths.reverse())
    await fs
      .rm(owned, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 300,
      })
      .catch((e) => console.error("Clean up fixture:", owned, e.code));
  await fs
    .rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 300,
    })
    .catch(() => {});
}
