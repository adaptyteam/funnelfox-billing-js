# CI/CD — Automated publishing pipeline

## How GitHub Actions works

GitHub Actions runs automated scripts on GitHub's servers whenever something happens to the
repo — a push, a PR opened, a PR closed, etc.

Workflow files live in `.github/workflows/`. Each file defines:

- **`on:`** — what event triggers the workflow (push, pull_request, etc.)
- **`jobs:`** — groups of steps that each run on a fresh virtual machine
- **`steps:`** — individual shell commands or reusable "actions" (e.g. `actions/checkout` to
  clone the repo, `actions/setup-node` to install Node.js)

Jobs can depend on each other with `needs:`. For example, `publish-dev` has `needs: check`,
so it only runs if typecheck, lint, and tests all pass first.

## Workflows in this repo

### `ci.yml` — runs on every push

One job: **`check`** — typecheck, lint, and tests. Runs on every branch including `main`.
Nothing else — no publish logic here, so it never shows unexpected skipped jobs in PRs.

### `publish-dev.yml` — manual trigger only

Triggered via the **"Run workflow"** button in the Actions tab (`workflow_dispatch`).
Runs checks, then publishes a dev build to npm tagged with the branch name.
Because it's in a separate file with only `workflow_dispatch` as the trigger, it never
appears in PR status checks and never runs accidentally on push.

### `publish-release.yml` — runs automatically on version tag push

Triggered when you push a tag matching `v*.*.*` to the repo. Runs checks, verifies the
tagged commit is on `main` (so you can't accidentally release from a feature branch), then
publishes to npm as the `latest` dist-tag.

### `cleanup.yml` — runs when a PR is closed (merged or abandoned)

Removes the branch's npm dist-tag so it doesn't accumulate indefinitely. The published
versions themselves stay on npm permanently (npm doesn't allow unpublishing after 24h), but
the named tag is removed so `@ffb-395` no longer resolves to anything.

## Version and tag scheme

Each manual publish creates a new version. The version is computed automatically — no manual
bumping needed for dev builds.

Example for branch `FFB-395` with `package.json` version `0.9.0-beta.7`:

| What | Value |
|---|---|
| Base version (prerelease stripped) | `0.9.0` |
| Branch slug (normalized) | `ffb-395` |
| Run number (auto-increments) | `3` |
| Published version | `0.9.0-ffb-395.3` |
| npm dist-tag | `ffb-395` |

Branch slug normalization: lowercased, non-alphanumeric characters replaced with `-`,
consecutive and leading/trailing dashes collapsed.

## Installing a dev build in another project

```bash
# Install by tag (always points to the latest build from that branch)
npm install @funnelfox/billing@ffb-395

# Or pin to an exact version
npm install @funnelfox/billing@0.9.0-ffb-395.3
```

After the PR is merged, the tag is removed. If you pinned an exact version it will still
install, but the named tag will no longer resolve.

## One-time setup

### 1. Configure npm Trusted Publishers (for `publish-dev.yml` and `publish-release.yml`)

Trusted Publishers lets GitHub Actions publish to npm using short-lived OIDC credentials —
no token stored anywhere.

1. Go to [npmjs.com](https://www.npmjs.com) → your package `@funnelfox/billing` → **Settings**
2. Under **Trusted Publishers**, click **Add publisher**
3. Fill in:
   - **Publisher type**: GitHub Actions
   - **GitHub owner**: your org or username
   - **Repository**: `funnelfox-billing-js`
   - **Workflow filename**: `publish-dev.yml` (exact, case-sensitive)
   - **Allowed action**: Publish
4. Save
5. Repeat for `publish-release.yml` — same fields, different workflow filename

That's it — no token needed in GitHub secrets for publishing.

### 2. Add `NPM_TOKEN` for tag cleanup (for `cleanup.yml`)

`npm dist-tag rm` is not covered by Trusted Publishers, so the cleanup workflow still needs
a token. Use a **Granular Access Token** scoped to just this package:

1. Go to [npmjs.com](https://www.npmjs.com) → avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**
2. Set an expiration, select package `@funnelfox/billing`, permission **Read and write**
3. In GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token

## Triggering a dev publish manually

1. Go to the GitHub repo → **Actions** → **Publish dev**
2. Click **Run workflow**
3. Select your branch from the dropdown
4. Click **Run workflow**

## Publishing a stable release

When your PR is merged to `main` and you're ready to publish:

1. Go to the GitHub repo → **Releases** → **Draft a new release**
2. Click **"Choose a tag"** → type `v1.0.0` → select **"Create new tag: v1.0.0 on publish"**
3. Set the target to **`main`**
4. Add release notes (optional)
5. Click **Publish release**

GitHub creates the tag and the `publish-release.yml` workflow fires automatically. It verifies
the tag points to a commit on `main`, stamps the version, builds, and publishes to npm as
`latest`. No local git commands needed.

```bash
# Confirm it published
npm view @funnelfox/billing dist-tags
```

The workflow fails if the tag doesn't point to a commit that's on `main` — this prevents
accidental releases from feature branches.

## Note on availability

Workflows are available in the Actions tab only after they exist on the **default branch
(main)**. Push and merge this branch first, then the "Run workflow" button appears.

```bash
# Verify what's published
npm view @funnelfox/billing dist-tags
```
