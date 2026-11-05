# Security

## Reporting a problem

Please report vulnerabilities privately, through [GitHub's vulnerability reporting](../../security/advisories/new), not in a public issue. Include the Hilo version and the steps to reproduce it.

This is a personal project, so there's no response time guarantee, but reports are taken seriously.

## Supported versions

Only the latest release gets fixes.

## What Hilo protects, and what it doesn't

- The renderer runs with `contextIsolation`, `sandbox` and no Node integration, under a strict content security policy, with no network access. Navigation and `window.open` are blocked.
- Every IPC handler checks its sender.
- The only network connection is the updater's, to `github.com` and `release-assets.githubusercontent.com`, over HTTPS.
- Git runs read-only, with an absolute path and with repository-defined commands disabled.

Known limits:

- **Installers aren't signed.** An update is only checked against the SHA-512 in `latest.yml`, downloaded over HTTPS. That doesn't protect against someone taking over the GitHub account.
- **Hilo runs real terminals.** Claude Code and your shell can do whatever your user account can do. With `--dangerously-skip-permissions` on, Claude runs everything without asking. That setting is off by default.
