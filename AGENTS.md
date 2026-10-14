# Working on Web Monitor

- Work in the existing checkout. Cloud tasks are isolated; do not create a Git worktree unless the user explicitly requests one.
- Prioritize stability, security and compatibility before new features. Keep Manifest V3 and avoid speculative full rewrites.
- Keep capture functions injected by `chrome.scripting.executeScript` self-contained. Preserve normal DOM, iframe and nested open Shadow DOM support.
- Invalid/loading/partial reads must not erase the last valid snapshot or become empty-queue alerts. Only compare snapshots from the same reading configuration.
- Preserve existing user configuration, notification integrations and the optional per-origin permission flow. Never commit credentials, profiles, internal queue URLs or webhook values.
- `npm run check` and `npm test` are required for logic changes. Run relevant browser fixtures with `npm run test:browser`; an installed Chromium can be selected through `CHROMIUM_PATH`.
- Browser fixtures simulate extension APIs. Do not claim that MV3 installation, real alarm lifecycle, corporate systems or external integrations work from fixture results alone. Never override browser administrative policy to test an extension.
- Record behavior changes in CHANGELOG.md and keep manifest/package versions consistent. Avoid large unrelated commits.
- Before store publication, consult current official Chrome Web Store requirements. License, multiple queues, adapters and corporate credential custody are separate work items.
