# CI Workflows (Proposed)

These GitHub Actions workflows were prepared during P3 cleanup but couldn't be
pushed directly because the current `GITHUB_TOKEN` lacks the `workflow` scope
(required to create/modify files under `.github/workflows/`).

## Files

- `ci.yml` — runs lint + typecheck + test on every PR and push to `main`
- `deploy-pages.yml` — builds and deploys to Cloudflare Pages on push to `main`

## How to activate

### Option A — Grant the token `workflow` scope (recommended)

1. Regenerate the GitHub Personal Access Token at
   https://github.com/settings/tokens with scopes: `repo` **and** `workflow`.
2. Re-run the cleanup, or push the two files from this folder to
   `.github/workflows/` with the new token.

### Option B — Manual copy via GitHub web UI

1. Go to https://github.com/6eu6/Palmkit/tree/main/.github/workflows
2. Click "Add file" → "Create new file"
3. Name it `ci.yml`, paste the contents of `ci.yml` from this folder, commit.
4. Repeat for `deploy-pages.yml`.

### Required GitHub Secrets (for `deploy-pages.yml`)

Before `deploy-pages.yml` will succeed, add these repository secrets at
https://github.com/6eu6/Palmkit/settings/secrets/actions :

- `CF_PAGES_API_TOKEN` — Cloudflare API token with "Cloudflare Pages" edit perms.
  Create at https://dash.cloudflare.com/profile/api-tokens
- `CF_ACCOUNT_ID` — `e130626263cc4abf610fa3ce5ac44f17` (provided in env keys)

Once activated, both workflows will run automatically.
