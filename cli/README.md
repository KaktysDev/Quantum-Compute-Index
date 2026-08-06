# qrouter.app

Quantum compute from your terminal. One command, one pasted API key, then plain
English.

```bash
npx qrouter.app
```

```
  QROUTER  one API key for quantum compute

  Create one at https://qrouter.app/dashboard/api-keys — it is pasted once and stored locally.

  › Paste your QRouter API key: ••••••••••
  ✓ Acme Labs · live key · qci_live_a1b2••••••
  ✓ $10.00 in credits
  ✓ 1 backend ready: QCI Aer CPU

  Ask anything, or describe a job to run. /help for commands.

  › run the quantum job at https://github.com/owner/repo using the qci cpu simulator
```

The assistant reads the repository, picks the circuit, and prepares a job. You
see QRouter's own quote and selected backend — not the model's guess — and
nothing runs until you type `run`. When it finishes, the full result lands in
your Downloads folder.

## Install

Nothing to install: `npx qrouter.app` fetches and runs it.

To keep it on your PATH:

```bash
npm install -g qrouter.app
```

or

```bash
curl -fsSL https://qrouter.app/install | sh
```

Requires Node 18.17 or newer. The package has no dependencies.

## Commands

| Command | What it does |
|---|---|
| `qrouter` | Start the assistant (the default) |
| `qrouter chat "run a bell state"` | Start it with a first message |
| `qrouter run <file.qasm\|repo-url>` | Run a circuit without the assistant |
| `qrouter status <job-id> [--wait]` | Check, or finish, an earlier job |
| `qrouter cancel <job-id>` | Ask the provider to stop a running job |
| `qrouter backends` | What this key can run on right now |
| `qrouter whoami` | Key, workspace, credits |
| `qrouter login` / `qrouter logout` | Store or forget the API key |

In the chat: `/help`, `/new`, `/history` (`/history <n>` opens one,
`/history delete <n>` removes it), `/backends`, `/balance`, `/session`,
`/results`, `/think`, `/key`, `/logout`, `/exit`.

`--json` puts a parseable document on stdout and moves every progress line to
stderr, so `qrouter run x.qasm --yes --json | jq .result.counts` works.

## Options

```
--shots <n>              shots to execute (default 1024)
--target <backend|auto>  pin a backend (default auto)
--mode <balanced|cost|speed|quality>
--max-cost <usd>         refuse routes quoted above this
--path <file.qasm>       circuit path, when the target is a repository
--ref <branch>           repository ref
--name <text>            label the job
--yes                    skip the confirmation prompt (required in scripts)

--key <qci_...>          use this key instead of the stored one
--base-url <url>         point at another deployment
--out <dir>              write results here instead of Downloads
--no-summary             write only the .json, not the .txt companion
--timeout <seconds>      give up waiting on a run (default 900)
--json                   machine-readable output where it applies
--no-color               plain text
```

Environment: `QROUTER_API_KEY` (never written to disk), `QROUTER_BASE_URL`,
`QROUTER_DOWNLOAD_DIR`, `QROUTER_CONFIG_DIR`, plus the usual `NO_COLOR`.

## Results

Every finished run — including a failed one, whose attempt trace is the part you
most want to keep — is written to your Downloads folder as:

```
qrouter quantum results ___ionq___ 2026-08-06 22-58-01.json
qrouter quantum results ___ionq___ 2026-08-06 22-58-01.txt
```

The JSON carries the job, the route decision and why it was made, the quote that
was charged, the circuit that was sent, the normalized counts and probabilities,
and the attempt/event trace. The `.txt` is the same thing for humans, with an
ASCII histogram. Existing files are never overwritten.

Downloads is resolved as `--out` → `QROUTER_DOWNLOAD_DIR` → the XDG user
directory on Linux → `~/Downloads` → the current directory.

## How a run is decided

The client deliberately decides nothing on its own:

1. `GET /api/v1/session` — is this key valid, funded, and pointed at a backend?
2. `POST /api/chat` — the same assistant the web console runs, told it is on a
   terminal. It may propose a job; it cannot execute one.
3. `GET /api/chat/circuit` — resolves a repository-referenced circuit to
   OpenQASM.
4. `POST /api/chat/quote` — the real routing engine picks the backend and prices
   the run. This is what the confirmation prompt shows.
5. `POST /api/v1/jobs` — only after you type `run`. Credits are reserved here.
6. `POST /api/v1/jobs/{id}/advance` — drives your own job while you wait, so a
   run completes even where no execution scheduler is deployed.
7. `GET /api/v1/jobs/{id}/result` — the counts that get saved.

## Security

- The key is written to `~/.config/qrouter/config.json` (`0600`, inside a `0700`
  directory) and is only ever displayed as a masked prefix.
- `QROUTER_API_KEY` takes precedence and is never persisted — use that in CI.
- `qrouter logout` removes the stored key.
- Provider credentials stay server-side. The client never sees them.
- Nothing runs, and nothing is charged, without an explicit `run` (or `--yes`,
  which you have to type yourself).

MIT licensed. Part of [QRouter](https://qrouter.app).
