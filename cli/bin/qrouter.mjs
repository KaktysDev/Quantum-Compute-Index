#!/usr/bin/env node
// Entry point for `npx qrouter.app` / the installed `qrouter` binary.

import process from "node:process";

const REQUIRED_MAJOR = 18;
const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major < REQUIRED_MAJOR) {
  process.stderr.write(
    `qrouter needs Node ${REQUIRED_MAJOR} or newer (this is ${process.versions.node}).\n` +
      "Install a current Node from https://nodejs.org and try again.\n",
  );
  process.exit(1);
}

const { main } = await import("../src/cli.mjs");

try {
  process.exitCode = (await main()) ?? 0;
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
