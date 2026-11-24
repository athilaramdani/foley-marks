# Development on Windows x64

Install Node.js 24, npm, a build-host Python with pip, and stable Rust for x86_64-pc-windows-msvc. Install the MSVC C++ Build Tools and a Windows SDK. WebView2 is needed to run the editor. The dependency lockfiles are inputs to builds.

```powershell
npm ci
pwsh -NoProfile -File media/prepare.ps1
npm run tauri -- dev
```

```powershell
npm run versioning -- check
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
src-tauri/resources/media-runtime/python.exe -B -m unittest discover -s media/tests -v
```

Use a synthetic media library for development. Generated Python packages, sidecars, native build output, personal media and signing material are ignored by Git. See [release preparation](release.md) for the installer build.
