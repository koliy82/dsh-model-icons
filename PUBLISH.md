# Publishing dsh-model-icons

Two separate things, and only the first one is required for the plugin to be
installable by anyone:

1. **put the code somewhere public** — a GitHub repository, and optionally an npm
   package;
2. **get it listed in the community registry** — one YAML file, one pull request
   to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
   The market inside DSH (`dshmarket`) reads that registry live and **refuses to
   install anything that is not on it**, so step 2 is what makes the plugin
   appear in the Plugin Market.

Nothing in this package needs a build step: `client/client.js` is a hand-authored
bundle in the loader's own factory-CJS protocol, and `lib/*.js` is plain ESM.
There are no runtime dependencies at all, so an install never asks for a build
approval.

## 1. Repository

```powershell
cd dsh-model-icons
git init -b main
git add -A
git commit -m "dsh-model-icons: vendor marks in the model picker"
git remote add origin https://github.com/<OWNER>/dsh-model-icons.git
git push -u origin main
```

Then, in the repository's GitHub settings:

- make it **public**;
- add the topic **`dsh-plugin`** (About → Topics) — the registry requires it;
- wait **one day** before opening the registry PR. Repo age is checked by CI and
  there is no commit-count bar; a repo created minutes before the PR is rejected
  automatically.

Point the manifest at that repository before publishing — the registry links an
npm package to a repo by reading the published `repository` field, so a
placeholder that reaches npm is a package attached to nothing:

```powershell
npm pkg set repository.url="git+https://github.com/<OWNER>/dsh-model-icons.git"
npm pkg set homepage="https://github.com/<OWNER>/dsh-model-icons#readme"
npm pkg set bugs.url="https://github.com/<OWNER>/dsh-model-icons/issues"
node scripts\prepublish-check.mjs   # must print "ready to publish"
```

`scripts/prepublish-check.mjs` is wired to `prepublishOnly`, so it also runs on
its own during `npm publish` and stops a placeholder, a missing file, or a
`lib/live.js` that drifted from `lib/index.js`.

## 2. npm (recommended, optional)

Publishing to npm is what lets the market show a download count and install a
prebuilt package instead of building from source. Listing does not depend on it.

```powershell
npm login                       # once; there is no ~/.npmrc on this machine yet
npm publish --access public     # runs the prepublish gate first
```

The name `dsh-model-icons` is free on npm as of 2026-10-15 (`npm view
dsh-model-icons` → 404). Check it again before publishing, and do not hand-write
an `npm:` key in the registry entry — the registry picks the mapping up from the
published `repository` field and rejects a manual one.

Users then install with:

```sh
dsh plugin --profile web add dsh-model-icons
```

## 3. GitHub Release tarball (only if you skip npm)

If the package is not on npm, attach a prebuilt tarball to a Release and point
the registry entry at it; otherwise the market offers a build-from-source
command. `npm pack` produces the asset (currently 33.8 kB, 10 files):

```powershell
npm pack        # -> dsh-model-icons-1.0.0.tgz
```

Upload it to a Release, then either keep the asset name version-free and use
`releases/latest/download/…`, or pin the tag. A versioned filename behind
`latest/download/` works on the day it is submitted and 404s at the next release.

## 4. The registry pull request

One new file in `awesome-dsh-plugin/awesome-dsh-plugin`, named after the repo:
`data/plugins/<OWNER>__dsh-model-icons.yml`. A ready copy, with the accurate
description this package's code actually backs, is in
[`docs/awesome-dsh-plugin-entry.yml`](docs/awesome-dsh-plugin-entry.yml) — replace
`<OWNER>` and paste it in. Do not edit either README there: both are generated
from `data/plugins/*.yml` after the merge.

```powershell
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-dsh-model-icons
mkdir -p data/plugins
cp <path-to>/docs/awesome-dsh-plugin-entry.yml "data/plugins/<OWNER>__dsh-model-icons.yml"
git add "data/plugins/<OWNER>__dsh-model-icons.yml"
git commit -m "add <OWNER>/dsh-model-icons"
git push -u origin add-dsh-model-icons
# then open the PR on GitHub
```

What CI checks, in order: at most 3 entries per PR; a `dsh.bundle` manifest in
the repo's `package.json` (this package declares `dsh.bundle.patch` and ships
`cordis.patch.yml`, which is what makes it installable — declaring only
`dsh.client` fails here); repo age ≥ 1 day; `awesome-lint` and the site build.
A maintainer then reads the repository and checks the description against the
code, which is why the wording in the entry file states only what this package
does: mirrored catalog and logos, three decorated surfaces, vendor rules,
monogram fallback.

The site and the market pick the entry up automatically after the merge,
usually within a day.

## 5. Screenshots (optional)

Storefronts show AppStore-style screenshots. Declare them in this repository,
not in the registry: add `screenshots.json` next to `package.json` listing 1–8
image paths relative to that file, and commit the images under `assets/`.
Absolute URLs must be GitHub-hosted https. Without the file, a storefront falls
back to extracting images from the README.

## Unpublishing

`npm deprecate dsh-model-icons "reason"` is the reversible way to steer users
away; `npm unpublish` is only allowed within 72 hours of the first publish and
only while nothing depends on it. Removing the registry entry is a separate PR
against your own `data/plugins/<OWNER>__dsh-model-icons.yml`.
