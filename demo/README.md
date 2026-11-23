# shadcn PR recording demo

Vite + React + Bun, initialized with shadcn and the full component registry.
The workspace uses sidebar-07, login-01, and signup-01 blocks.

```sh
bun install --frozen-lockfile
bun run dev -- --host 127.0.0.1 --port 3000
```

Login and signup are local demo forms. No authentication service or real
accounts are involved. Browser journeys are in webreel.config.json. See the
repository README for the action.

On **Recordings**, search journey names and descriptions, filter reviewed
journeys, and mark each journey as reviewed or pending. The summary counts
update immediately. Review status is saved in this browser across navigation
and reloads; it is not shared with other reviewers.

With the demo server running, record the review workflow from the repository
root:

```sh
npx webreel record recording_reviews -c demo/webreel.config.json
```

This journey covers search, review updates, persistence across navigation, combined
filters, and empty-state recovery.
