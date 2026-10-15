# dsh-model-icons

Vendor marks in the DeepSeek Harness Web GUI model picker — the same marks the
provider's own dashboard draws next to each model, in the same way it draws them.

| Surface | What appears |
|---|---|
| Composer model menu | one 16 px monochrome mark before every model row |
| Composer model button | the selected model's mark before its name (14 px) |
| `/model` command popup | the same mark on every row |
| A skin that redraws the picker (`dsh-claude-style`) | the same mark, and the skin's own lockup is hidden in that row so two never meet |

The marks are painted with a CSS mask filled by `currentColor`, which is how the
provider's dashboard paints them: one file per vendor serves both palettes and
every row state (hover, selected, disabled) with no colour variants.

## Where the pictures come from

Nothing is embedded in this package. The host half mirrors two public things from
the provider's site into this profile, and the browser half reads them from
loopback:

1. **the model catalog** — the site renders its model table from a JSON island in
   its own page (`<script id="rustvy-catalog">`), so an unauthenticated reader is
   handed exactly the data the dashboard shows: model id, display name, vendor
   and the logo file name that vendor uses. Mirrored to
   `<profile>\.dsh-model-icons\catalog.json`.
2. **the logo files** (`/logos/<name>.svg`) — copied into
   `<profile>\.dsh-model-icons\logos\` on first use.

Both are read on the process's own outbound route (`lib/net.js`): the live global
dispatcher first, so a proxy installed by `dsh-proxy-gui` — or any other route the
process has — is followed, and a connector built here from `HTTPS_PROXY` /
`ALL_PROXY` / `HTTP_PROXY` second, for the case where no dispatcher is installed.
`NO_PROXY` is honoured on both. The page itself never leaves the machine: the
browser asks `127.0.0.1` for a mark, which is what makes this work on a machine
whose browser cannot reach the origin at all.

The catalog refreshes once every 24 hours and on demand; a cold mirror is waited
for up to 6 seconds, and a stale one refreshes in the background while the rows
keep the marks they have. When the origin is unreachable, the cache on disk still
serves everything it holds.

## Matching a row to a mark

Rows are matched by their visible name, in this order:

1. the mirrored catalog's model id (`claude-opus-5-5`, `abyss/glm-5.3`, …);
2. its display name (`OPUS 5.5`);
3. an id the label *starts* with — a skin can leave its own description line in
   the same element, so the name is often a prefix rather than the whole string,
   and the longest matching id wins so `claude-opus-5-5` is never claimed by
   `claude-opus-5`;
4. the shape of the id, for a model the mirror has never seen: `claude-*` →
   Anthropic, `gpt-*`/`o1…o9` → OpenAI, `glm-*` → Zhipu, `kimi-*`/`k3` →
   Moonshot, `qwen-*` → Alibaba Qwen, `deepseek-*` → DeepSeek, `ahmia-*` → Ahmia,
   `mimo-*` → Xiaomi, `fable-*` → Anthropic, `gemini-*` → Google, `grok-*` → xAI.

A model that matches nothing gets no mark at all — an invented icon would be a
wrong answer rather than a missing one. A model that matches but whose logo the
mirror could not fetch gets a monogram chip (the vendor's first letters) instead
of a blank box: a mask whose URL 404s would otherwise paint a solid square.

Effort rows, provider headings, the menu's root cells, the search field and
catalog-failure rows are matched by nothing and stay bare.

## Routes

One prefix registration on the harness's own web server. Plugin routes are not
seen by the host's request fence, so every one of them checks the peer itself:
loopback only, a loopback `Host`, a same-origin `Sec-Fetch-Site` and a matching
`Origin`.

| Route | Method | Answer |
|---|---|---|
| `/dsh-model-icons/catalog.json` | GET | the mirrored catalog plus the settings the browser half draws with |
| `/dsh-model-icons/logo/<name>.svg` | GET, HEAD | one cached logo, fetched from the origin on first ask; `404` when the origin has no such mark, `400` for any name that is not `[A-Za-z0-9._-]+.svg` |
| `/dsh-model-icons/state` | GET | mirror status for the settings page: version, model count, cached logos, route, proxy (credentials masked), cache directory, last error |
| `/dsh-model-icons/refresh` | POST | re-read the catalog and re-warm every logo it names |
| `/dsh-model-icons/config` | POST | write settings; never touches the network |

## Settings

**Settings → Иконки моделей**

| Switch | Default | Meaning |
|---|---|---|
| Показывать иконки моделей | on | master switch; off removes every mark |
| Иконка в кнопке выбранной модели | on | also mark the composer's model button, not just the menu rows |
| Прятать логотипы других скинов | on | hide a skin's own lockup in a row this plugin marked |

The page also shows what the mirror holds and refreshes it on demand.

Stored in `<profile>\.dsh-model-icons\config.json`. Two environment variables
override it, for a deployment that points the mirror elsewhere or wants the
plugin mounted but inert: `DSH_MODEL_ICONS_ORIGIN` (default `https://rustvy.xyz`)
and `DSH_MODEL_ICONS_DISABLED=1`. The mark size is a config field (`size`,
10–32 px, default 16).

## No restarts

The host half reloads itself, the same way `dsh-proxy-gui` does: the loader row
names `./lib/live.js`, which imports the implementation through a cache-busting
`?rev=` query, and a one-second poll of the `lib` directory disposes the previous
revision and starts the next one once a changed fingerprint repeats. The browser
half arrives in an open page through the harness's own live plugin composition;
a page refresh works too.

## Install

```powershell
pwsh -File .\install.ps1
```

Copies the package into `<profile>\node_modules\dsh-model-icons` as a real
directory, regenerates `lib/live.js` from `lib/index.js` so the two cannot drift,
and appends the package to `dsh.profile.bundles` in the profile manifest. A
running harness picks the row up from the manifest change.

Uninstall: remove the name from `dsh.profile.bundles`, delete
`<profile>\node_modules\dsh-model-icons`, and delete
`<profile>\.dsh-model-icons` if you also want the cache gone.

## Layout

| File | Role |
|---|---|
| `lib/index.js` | stable loader entry; owns the reload loop |
| `lib/live.js` | byte-identical copy of the entry, named by the loader row |
| `lib/host.js` | routes, catalog mirror, logo cache, settings |
| `lib/net.js` | one outbound GET on the process's route, then the environment's proxy |
| `client/client.js` | hand-authored browser bundle: the decorator and the settings page |
| `cordis.patch.yml` | the loader row the profile's bundle list pulls in |
| `install.ps1` | install into a profile |

## Tests

Both halves are covered without touching the running app:

```powershell
node _probe\model-icons-host-test.mjs      # host: fake webServer, real origin fetch
node _probe\dom-test\model-icons-client-test.mjs   # browser: linkedom + stubbed mirror
```

The host test drives the registered route with fake request/response pairs and
asserts the catalog answer, a real logo fetch, `404` for a mark the origin does
not have, `400` for a traversal attempt, `403` for a non-loopback peer, `405` for
a wrong method, and the on-disk cache. The client test builds the exact markup
the harness menu, the `/model` popup and the skin render, and asserts which rows
get a mark, which icon each gets, that effort rows and headings stay bare, that
the monogram fallback appears for a missing logo, that a row added later is
picked up by the observer, that a pass is idempotent, and that an unload removes
every trace.
