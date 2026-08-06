// ─────────────────────────────────────────────────────────────────────────────
// GET /install — the `curl -fsSL https://qrouter.app/install | sh` script.
//
// `npx qrouter.app` is the primary path and needs nothing hosted. This exists
// for people who want the command on their PATH permanently, and for machines
// where npx's per-run download is a nuisance.
//
// The script is deliberately small and readable: anyone piping a URL into a
// shell should be able to read it first with `curl https://qrouter.app/install`,
// and everything it does is one `npm install -g qrouter.app`.
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGE = "qrouter.app";

const SCRIPT = `#!/bin/sh
# QRouter CLI installer — https://qrouter.app
#
# Installs the '${PACKAGE}' npm package globally and exposes it as 'qrouter'.
# Read before running:  curl -fsSL https://qrouter.app/install
#
# Prefer no install at all?   npx ${PACKAGE}

set -eu

red()  { printf '\\033[31m%s\\033[0m\\n' "$1" >&2; }
info() { printf '  %s\\n' "$1"; }

if ! command -v node >/dev/null 2>&1; then
  red "Node.js is required but was not found on PATH."
  red "Install Node 18 or newer from https://nodejs.org and run this again."
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$MAJOR" -lt 18 ]; then
  red "Node 18 or newer is required (found $(node -v))."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  red "npm is required but was not found on PATH."
  exit 1
fi

printf '\\n  Installing the QRouter CLI…\\n\\n'

if npm install -g ${PACKAGE} >/dev/null 2>&1; then
  :
elif command -v sudo >/dev/null 2>&1; then
  info "Global install needs elevated permissions; retrying with sudo."
  sudo npm install -g ${PACKAGE}
else
  red "Could not install globally. Try:  npm install -g ${PACKAGE}"
  red "Or skip installing entirely:      npx ${PACKAGE}"
  exit 1
fi

if command -v qrouter >/dev/null 2>&1; then
  info "Installed $(qrouter --version)."
  printf '\\n  Start it with:  qrouter\\n\\n'
else
  info "Installed, but 'qrouter' is not on PATH yet."
  info "Open a new shell, or check: npm bin -g"
  printf '\\n'
fi
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      // Installers are fetched fresh; a stale cached script is worse than a
      // round trip.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
