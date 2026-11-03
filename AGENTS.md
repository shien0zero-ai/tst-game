# Development agreement

Continue this project as a JavaScript + Three.js browser game. Prefer free tools
and a small dependency set. The user is new to GitHub and game development;
explain required manual actions in Japanese with concrete, numbered steps.
The user's chosen source repository is `shien0zero-ai/tst-game`. Keep this game,
its setup, and documentation in this repository when continuing development.

## Tools and costs

- Before adding a necessary tool, library, or service, explain its name, purpose,
  and whether it is free or paid. Install suitable free project dependencies
  automatically when authorized by the feature request; update the lockfile and
  run checks relevant to the change. Do not add packages without a current need.
- Prefer free software and freely licensed or locally generated assets. Explain
  licenses when they affect the intended distribution.
- Before using anything that would incur a charge, explain the cost and propose
  a free alternative. Obtain the user's agreement before creating a paid
  subscription, starting a billable resource, or buying an asset.
- Before an engine migration (for example Unreal Engine), a new native runtime,
  or a major change in production tools, explain the reason, benefits, costs,
  and tradeoffs and wait for the user's decision. Keep the existing stack unless
  such a change is agreed upon.

## Development workflow

- Prepare the smallest playable version of a feature before adding extras.
- The cloud task already has an isolated checkout. Use the existing checkout;
  do not create a Git worktree unless the user requests one.
- Recommended toolchain: Node.js 24 LTS (version pin in `.nvmrc`), npm, Three.js,
  Vite, and Playwright. Use `npm ci` to reproduce `package-lock.json`.
- `npm test` exercises voxel world and player physics. `npm run build` creates
  the browser build. For changed interactions, start `npm run dev` and run
  `npm run test:browser` in another terminal. Report checks actually executed.
- Browser tests use `CHROMIUM_PATH` when specified, otherwise an installed
  system Chromium on Linux, otherwise Playwright's Chromium. The latter can be
  installed with `npm run test:browser:install`.
- `npm run export` generates the single-file game in
  `artifacts/fieldcraft.html`. Re-export after game changes when distributing
  the download version. Refresh distribution files after changes to their
  source; do not mistake an old export for the latest game.
- Preserve existing user changes. Keep `node_modules`, `dist`, generated
  `artifacts`, and secrets out of Git. Do not claim files are backed up to
  GitHub unless their commit and push have actually been verified.

## Helping the user

- Cloud development and playing the exported HTML do not require a local Node.js
  installation. If local development is requested, explain exactly which
  software must be installed on the user's PC and link to the official installer.
- Maintain the beginner guide in `docs/DEVELOPMENT.md` when the workflow changes.
- Distinguish cloud setup, local PC setup, GitHub source backup, Codex environment
  publication, and hosting a playable website. Completing one does not complete
  the others. Respect the user's publication instructions; do not publish or
  deploy merely to demonstrate a change.
