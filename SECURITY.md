# Security reports

Report security issues privately to the maintainer through GitHub's private vulnerability reporting when enabled. Contact Athila Ramdani directly if the option is unavailable. Include the affected version, expected behavior, impact and a minimal synthetic example. Keep project media and signing keys out of reports.

The desktop editor processes media locally. The updater downloads a signed release over HTTPS. Its verification public key ships with the app. Production private keys belong in protected signing storage. An updater signature authenticates application updates. Windows Authenticode requires a separate code-signing certificate.
