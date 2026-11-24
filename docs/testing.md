# Testing report

## Legacy baseline

On 24 November 2026, the legacy Windows application passed its startup check and all 98 Python tests using Qt's offscreen platform. Its tests used synthetic files and covered media edits, time mapping, migration and rendering. This baseline does not measure audible synchronization in a physical room or device.

## Verification matrix

- TypeScript, ESLint and Vite production build passed. All 13 frontend regression tests passed.
- Edge browser integration with mocked Tauri IPC passed import, playback, synchronized clip playback, split, undo/redo, save, reload and settings. One sampled playback offset was 28 ms.
- Rust formatting, release-profile Clippy and all eight native unit tests passed.
- The embedded Python runtime passed all six media tests with the production FFmpeg build. The render test checks both sides of a trimmed cue against the expected times within 25 ms.
- A separate moving-object fixture produced six optical-flow events and six automatic cues with the production runtime.
- Nine production executable integration checks passed on Windows 11. These covered startup and settings, Unicode dataset discovery, media probing, waveform and cache, real WebView2 playback and seek, v1 import and clip split, analysis preserving a manual cue, recovery, timed export, and unauthorized path rejection. Run `node scripts/native-qa.mjs` from a prepared development tree to repeat the checks.
- The Windows 11 x64 installer smoke passed. It verified the installed runtimes, Start Menu shortcut, desktop startup, native settings IPC, uninstall, and preservation of a separate directory with a Unicode name.
- The release workflow verifies the installer signature against the embedded key and matches the manifest's signature and download URL to the release artifacts. It publishes after the tests and installer smoke succeed.
- The locally built Windows x64 NSIS package passed signature verification. The verifier rejected a copy modified by one byte.
- A local update rehearsal upgraded a private 0.9.0 test build to 1.0.0, rejected a downgrade and a damaged payload, restarted automatically, and preserved settings. The harness also checked the external preservation marker through installation and uninstall. It did not publish the test build.
- The v1.0.0 Actions job passed tag validation, source codec build, packaging, and installer signature verification. WebView2's QA endpoint did not start on the hosted runner. The exact signed draft installer then passed the full desktop, package lifecycle, and staging update checks on Windows 11 before promotion. Future hosted release jobs verify the installed package and runtimes. The full desktop smoke remains a local release check.

## Manual coverage

Use a Windows 10 x64 machine and a Windows 11 x64 machine to review WebView2 bootstrap when the runtime is missing, high-DPI behavior, native file dialogs, keyboard and pointer interaction, and audio timing on physical speakers. For a future update, test in-place replacement, retry after a network failure, artifact tamper rejection, media preservation and restored editing state under a staging endpoint. Measure long projects, high bitrate and variable-frame-rate assets with representative synthetic media.

Refer to the release job logs for the build-specific CI and installer result. A successful smoke test establishes the exercised path for that runner and profile.

## Migration fixes and limits

- A trimmed SFX uses its source offset during mixing. Video edits move linked cues using the legacy segment mapping. The export is staged before publication to avoid leaving a partial dataset on failure.
- Matching legacy references and Unicode Windows paths are handled locally. User-selected folder grants govern file access, including when a project contains stale paths.
- Legacy event analysis uses optical flow. Test coverage here does not include an external pose model. The current workspace exposes a subset of the legacy annotation and library metadata controls.
- WebView2 codec support governs interactive preview. Frame-step uses the probed frame rate. Verify exact frame navigation on variable-frame-rate video.
- The workspace language setting translates the principal workspace labels. Some dialogs and editor controls still use English. Hardware acceleration follows the WebView2 runtime. The FFmpeg export uses software encoding.
