# Contributing to Hilo

Bug reports, ideas and pull requests are welcome. The interface, comments and documents are in Spanish, but you can write issues and pull requests in English or Spanish.

## Setup

You need Windows, Node.js 22 or newer, and Git.

```
npm ci
npm start
```

## Before opening a pull request

```
npm run typecheck
npm test
npm run e2e
```

`npm run e2e` drives the real app with Playwright, without Claude. Tests that use a real Claude Code session are opt-in and listed in [CLAUDE.md](CLAUDE.md), along with the project layout and known traps.

Keep each pull request to one change, and add a test that fails without it when you can.

## How we work

The maintainers work through Issues and small pull requests, one per Issue, on their own branch. Put `Closes #N` in the pull request body so the Issue closes on merge. Every pull request needs CI to pass and an approval from the owner, and `main` is merged with squash. Commits are in Spanish, use the GitHub noreply email, and carry no AI signatures. The full workflow, in Spanish, is in [docs/memoria/colaboracion.md](docs/memoria/colaboracion.md).

Run `npm run privacy` before pushing: it fails on personal emails, Windows paths with a user name, and keys.

## Rules that don't bend

Hilo runs inside people's daily work, so these come first. A change that breaks one of them won't be merged, however useful it is. [CLAUDE.md](CLAUDE.md) has the full list.

- **No new network connections.** The only one is the updater, to GitHub. No telemetry, and everything is bundled.
- **Never read credentials**, and never touch `~/.claude/settings.json`, `~/.claude.json` or anything else global.
- **Don't close processes Hilo didn't start.**
- **Git is read-only**, and nothing a repository configures gets executed.
- **Every IPC handler checks its sender**, and the renderer stays sandboxed.

Read [docs/DECISIONES.md](docs/DECISIONES.md) before changing how something works: it explains why things are the way they are, including what was tried and failed.

## Reporting a bug

Use the [bug report form](../../issues/new/choose). Your Hilo and Claude Code versions and the steps to reproduce help the most. Check that screenshots and logs don't show private paths or code.

For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
