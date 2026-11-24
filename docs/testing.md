# Testing report

## Legacy baseline

On 24 November 2026, the legacy Windows application passed its startup check and all 98 Python tests using Qt's offscreen platform. Its tests used synthetic files and covered media edits, time mapping, migration and rendering. This baseline does not measure audible synchronization in a physical room or device.

## Verification matrix

- TypeScript, ESLint and Vitest exercise the frontend, followed by a Vite production build.
- Rust formatting, Clippy and unit tests validate native data and path handling.
- Python media tests use generated media for probe/waveform, edits, automatic annotation, and rendering.
- The Windows installer smoke checks startup, native IPC, uninstall, and a separate directory with a Unicode preservation marker.
- The release workflow verifies the installer signature against the embedded key and matches the manifest's signature and download URL to the release artifacts. It publishes after the tests and installer smoke succeed.

## Manual coverage

Use a Windows 10 x64 machine and a Windows 11 x64 machine to review WebView2 bootstrap when the runtime is missing, high-DPI behavior, native file dialogs, keyboard and pointer interaction, and audio timing on physical speakers. For a future update, test in-place replacement, retry after a network failure, artifact tamper rejection, media preservation and restored editing state under a staging endpoint. Measure long projects, high bitrate and variable-frame-rate assets with representative synthetic media.

Refer to the release job logs for the build-specific CI and installer result. A successful smoke test establishes the exercised path for that runner and profile.
