# Windows releases and updates

FoleyMarks uses Tauri's official updater. The app checks GitHub Releases for a higher version, displays the release notes and download progress, saves recovery state, and hands the signed installer to Windows. NSIS keeps the same application identifier and current-user scope on each release. Each update installs the full application bundle.

The installer uses updater signatures. Authenticode signing and Windows publisher reputation require a separate code signing certificate.

## Prepare a tagged release

1. Build and test on Windows. Review a legacy session with its media and test audio synchronization through playback and export.
2. For a later release, run `npm run versioning -- set X.Y.Z` and update the changelog. The command updates package, lock, Tauri and Cargo versions. Keep the product ID, install scope and updater verification key consistent.
3. Check `npm run versioning -- check vX.Y.Z`, commit the changes, and push the branch. Review the CI results.
4. Ensure the repository Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are configured for the production verification key. Keep a protected backup outside the repository.
5. Run `git tag -a vX.Y.Z -m "FoleyMarks vX.Y.Z"` and `git push origin vX.Y.Z`. The release workflow tests the tag, builds corresponding media sources and Windows binaries, signs the installer through tauri-action and stages a draft. It verifies the signature, manifest and installer lifecycle before publishing.
6. Verify the published installer, updater JSON, signature and SHA-256 checksum. Keep the corresponding source archive available with the release.

The public update endpoint serves `latest.json` from GitHub Releases. For a private distribution, configure an authorized HTTPS update service before building the app. Release downloads must work for users without embedding GitHub credentials in the app.

## Local installer build

Build the pinned FFmpeg tools on Linux using `bash media/build-codecs.sh "$PWD/codec-dist"`. Stage those outputs on Windows, run `pwsh -NoProfile -File media/prepare.ps1 -CodecDir ./codec-dist`, and generate third-party notices with `node scripts/notices.mjs`. Load the Tauri signing environment variables from protected storage, then run `npm run tauri -- build --target x86_64-pc-windows-msvc --ci -- --locked`. Test the installer using `scripts/installer-smoke.ps1` in a clean profile.

For an end-to-end update rehearsal, use an isolated Windows profile and test endpoint with a separate signing key or a local controlled test fixture. Test upgrade, restart, rejection of modified artifacts, and preservation of dataset, project and settings. Never publish artificial production versions for this exercise.
