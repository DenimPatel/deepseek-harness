# Running a local build of DeepSeek Harness

This checkout is used to build and serve the harness from source, on a second
port, next to the packaged install. Everything below was run and verified on
macOS (darwin) on `master`.

Two instances can coexist because they are different installs with different
state:

| Instance | Version | Port | `DSH_HOME` | Launched by |
|---|---|---|---|---|
| Packaged | `0.1.5-rc.1` | 3080 | `~/.dsh` | `npx @deepseek-ai/dsh@latest web` |
| Local build | `0.1.6-alpha.1` | 3081 | `~/.dsh-local` | `./local-web.sh` (this repo) |

## Prerequisites

- Node.js matching the repo's `engines` field, `^22.19.0 || >=24.0.0`
  (verified with `v25.6.1`).
- pnpm at the version the repo pins in `packageManager`, currently `11.7.0`.
  Corepack is not required.
- `DEEPSEEK_API_KEY` exported in the environment. It is the credential the
  `deepseek-official` route resolves, and it is already set in `~/.zshrc`.

```sh
npm install -g pnpm@11.7.0
pnpm --version   # 11.7.0
```

The last item needs care. `~/.zshrc` is read by interactive shells only, so the
variable is present in your terminal and absent from a bare `zsh -l -c`. Any
launcher that does not read `~/.zshrc` must export the key itself:

```sh
[ -n "$DEEPSEEK_API_KEY" ] && echo present || echo absent
```

## Install dependencies

```sh
cd "$(git rev-parse --show-toplevel)"
pnpm install
```

Took about one minute here. The `Failed to create bin ... .bin/dsh` warnings for
`apps/desktop-host`, `packages/sdk/client`, and `python/sdk-runtime` are expected
before a build: they point at `apps/cli/lib/bin.js`, which does not exist yet.

## Build

```sh
pnpm run build
```

`pnpm run build` runs `tsx scripts/build.ts`. It produces the two artifact sets
the production web runner needs:

- `apps/cli/lib/bin.js` — the built CLI launcher.
- `apps/web/dist/` — the browser bundle and its asset manifest.

`pnpm run build` must be re-run after a fresh checkout and whenever artifacts
need updating. Once the host artifacts exist, `pnpm dsh <args>` runs from source
through `tsx` without rebuilding; `node apps/cli/lib/bin.js <args>` runs the
built launcher. A stale binary is not detected, so rebuild after pulling.

## Run on a second port

`dsh web` is a hardcoded alias for `--profile web`. Its flags are `--host`,
`--port`, repeatable `--trusted-host`, and `--no-open`; the default port is 3080.

```sh
./local-web.sh          # port 3081
./local-web.sh 3090     # custom port
```

`local-web.sh` is a thin wrapper that does three things:

1. Pins `DSH_HOME` to `~/.dsh-local` unless you set one, so the two versions
   never share profiles, sessions, or storage.
2. Warns when `DEEPSEEK_API_KEY` is unset, because `deepseek-official` requests
   fail without it.
3. Execs `node apps/cli/lib/bin.js web --port "$PORT" --no-open`.

It reads no credentials file and writes none. `DEEPSEEK_API_KEY` reaches the
server through the environment, and any other provider key such as
`OPENROUTER_API_KEY` passes through the same way.

The isolation is deliberate. The two instances are different versions of a
developer preview that advertises compatibility-breaking changes, and
`$DSH_HOME/profiles` and `$DSH_HOME/storages` are shared mutable state. Point
both at `~/.dsh` only if you accept that risk.

The equivalent source-run form, which needs no build step at all:

```sh
pnpm dsh web --port 3081 --no-open
```

## Verify

Startup prints the tokenised URL; the bare host returns `401` because the token
is required:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/    # 401
```

The launcher version identifies the build:

```sh
node apps/cli/lib/bin.js --version    # 0.1.6-alpha.1
```

To confirm the running server is serving *this* build rather than a cached
package, compare the asset refs in the served HTML with the local bundle:

```sh
curl -sL -c jar -b jar "http://127.0.0.1:3081/?token=$TOKEN" \
  | grep -o './assets/[A-Za-z0-9_.-]*'
grep -o 'assets/[A-Za-z0-9_.-]*' apps/web/dist/index.html
```

Both list the same `index-*.js`, `vendor-*.js`, and `vendor-*.css`. Verified
equivalent: `index-Ly7KS3xS.js`, `vendor-CCJJTK99.js`, `vendor-BNsW4eBh.css`.

A one-shot headless run exercises the model route end to end without the UI and
exits 0 on success:

```sh
DSH_HOME="$HOME/.dsh-local" \
  node apps/cli/lib/bin.js --profile headless "Reply with exactly the single word: ready"
```

Verified: prints `ready` and exits `0`, so the local build resolves the default
route and completes a real model call. Run it from an interactive terminal, or
it will not see `DEEPSEEK_API_KEY`.

## Model configuration

The local instance reads `~/.dsh-local/settings.yaml`. It defaults to DeepSeek's
own route, which resolves `DEEPSEEK_API_KEY`:

```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek-flash
```

`deepseek-official` is registered by `dsh-llm-deepseek`, whose `apiKeyEnv`
defaults to `DEEPSEEK_API_KEY`. Its catalog offers `deepseek-flash` (text and
image), `deepseek-v4-flash`, `deepseek-v4-pro`, and
`deepseek-v4-flash-vision-exp`. An OpenRouter key cannot satisfy this route; the
two are separate providers with separate credentials.

The OpenRouter provider is still configured in the same file, so switching to it
is a picker change or a two-line edit to `agent-default-model`:

```yaml
llm-pi-ai:
  providers:
    openrouter:
      apiKeyEnv: OPENROUTER_API_KEY
      api: openai-completions
      baseURL: https://openrouter.ai/api/v1
      models:
        - id: ~deepseek/deepseek-v4-flash-latest
          name: DeepSeek V4 Flash Latest
          contextWindow: 1048576
          maxTokens: 131072
```

Settings are re-read on the next request, so editing this file needs no restart.
Because the keys arrive through the environment, `~/.dsh-local/.credentials.yaml`
holds no `refs` entry and no secret. The Models page writes to the same document
if you prefer the form.

## Stopping, rebuilding

Stop a foreground instance with `Ctrl+C`, or `SIGTERM` for a clean drain (the
plugin tree gets up to five seconds to dispose; a second signal forces exit).
After changing source:

```sh
pnpm run build
./local-web.sh
```

### The port is already in use

Only one process can bind a port, so a second start fails with `EADDRINUSE`.
The boot failure is noisy — `webserver (@deepseek-ai/dsh-host-webserver):
Error: listen EADDRINUSE: address already in use 127.0.0.1:3081`, followed by
`required startup failure: 2 entries did not activate` and a list of eight
entries stuck `pending`. The `pending` entries are the cascade: they wait on
`webServer`, `webRuntime`, or `connection`, none of which can activate because
the listener never bound. Nothing is wrong with the build.

Find and stop the holder:

```sh
lsof -ti tcp:3081              # PIDs listening on the port
kill "$(lsof -ti tcp:3081)"    # SIGTERM; the tree drains before exit
lsof -ti tcp:3081              # empty means the port is free
```

`kill -9` only if the graceful stop is refused, and never while a session is
mid-request. Two instances sharing `~/.dsh-local` will also fight over profiles
and storage, so stop the old one rather than starting a second.

## Caveats

- DeepSeek Harness is in developer preview. `0.1.6-alpha.1` here is not the
  `latest` npm tag, so it can behave differently from the packaged install on
  3080.
- `--host 0.0.0.0` is rejected on purpose; the web app binds localhost.
- `LOCAL_BUILD.md` and `local-web.sh` are the tracked helper for this workflow.
  `local-web.sh` derives the repository root from its own location, so it runs
  from any clone path.
- The web UI writes API keys into `.credentials.yaml` with mode `0600`. Do not
  hand-edit that file; save through the Models page instead.
