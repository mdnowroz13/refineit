# Local RefineIt Action

This composite action runs `npx refineit` (uses local dependency if present via `npm ci`, else npx fetch).

Inputs:
- `args` : CLI args for refineit. Default `--dry-run --export-report refineit-report.json`
- `create-pr` : 'true' to create branch & PR (requires `.github/refineit.yml` + `PUSH_TOKEN` secret)
- `push-branch` : branch name to push changes to (optional)
- `working-directory` : run inside subfolder (optional)

Artifacts uploaded: `refineit-report.json`, `refineit-debug.json`.
