// Terminal presentation: colour, layout, spinners, prompts.
//
// Everything here degrades to plain ASCII when stdout is not a TTY, when
// NO_COLOR is set, or when --no-color is passed, so piping `qrouter` into a file
// produces clean text rather than escape soup.

import process from "node:process";

const state = {
  color: null, // resolved lazily so --no-color can be applied before first use
  unicode: null,
  // In --json mode every human-facing line moves to stderr so stdout carries
  // nothing but the document a script is trying to parse.
  quiet: false,
};

export function configure({ color, unicode, quiet } = {}) {
  if (color !== undefined) state.color = color;
  if (unicode !== undefined) state.unicode = unicode;
  if (quiet !== undefined) state.quiet = quiet;
}

/** Where human-facing output goes: stdout normally, stderr in --json mode. */
function narration() {
  return state.quiet ? process.stderr : process.stdout;
}

function colorEnabled() {
  if (state.color !== null) return state.color;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

function unicodeEnabled() {
  if (state.unicode !== null) return state.unicode;
  if (process.platform === "win32" && !process.env.WT_SESSION && !process.env.TERM_PROGRAM) return false;
  const encoding = String(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "").toLowerCase();
  if (encoding && !encoding.includes("utf")) return false;
  return true;
}

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};

function wrap(code, text) {
  if (!colorEnabled()) return text;
  return `\u001B[${code}m${text}\u001B[0m`;
}

export const style = Object.fromEntries(
  Object.entries(CODES).map(([name, code]) => [name, (text) => wrap(code, String(text))]),
);

/** Truecolor accent used for the brand mark; falls back to cyan. */
export function accent(text) {
  if (!colorEnabled()) return text;
  return `\u001B[38;2;120;170;255m${text}\u001B[0m`;
}

export const glyph = new Proxy(
  {
    tick: ["✓", "OK"],
    cross: ["✗", "x"],
    dot: ["·", "-"],
    arrow: ["→", "->"],
    bullet: ["•", "*"],
    caret: ["›", ">"],
    warn: ["!", "!"],
    bar: ["│", "|"],
    corner: ["└", "`"],
    top: ["┌", ","],
    block: ["█", "#"],
    halfBlock: ["▌", "|"],
    ket: ["⟩", ">"],
  },
  {
    get(target, key) {
      const pair = target[key];
      if (!pair) return "";
      return unicodeEnabled() ? pair[0] : pair[1];
    },
  },
);

export function width() {
  const columns = process.stdout.columns || 80;
  return Math.max(40, Math.min(columns, 100));
}

/** Visible length, ignoring ANSI escapes. */
export function visibleLength(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001B\[[0-9;]*m/g, "").length;
}

/** Hard-wraps a paragraph to `max` columns, breaking on whitespace. */
export function wrapText(text, max = width(), indent = "") {
  const limit = Math.max(20, max - indent.length);
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!line.length) {
        line = word;
      } else if (visibleLength(line) + 1 + visibleLength(word) <= limit) {
        line += ` ${word}`;
      } else {
        lines.push(indent + line);
        line = word;
      }
    }
    if (line.length) lines.push(indent + line);
  }
  return lines;
}

export function line(text = "") {
  narration().write(`${text}\n`);
}

export function blank() {
  narration().write("\n");
}

/** Machine-readable payload. Always stdout, never decorated. */
export function data(text) {
  process.stdout.write(`${text}\n`);
}

// Status lines. Every "  <mark> message" the client prints goes through these,
// so the gutter, the glyph and the colour cannot drift between call sites.

/** Neutral note. */
export function info(text) {
  line(`  ${style.gray(glyph.dot)} ${text}`);
}

/** Something is true and working. */
export function success(text) {
  line(`  ${style.green(glyph.tick)} ${text}`);
}

/** Something failed. */
export function failure(text) {
  line(`  ${style.red(glyph.cross)} ${text}`);
}

/** Something worked but the user should know about it. */
export function warn(text) {
  line(`  ${style.yellow(glyph.warn)} ${text}`);
}

/** Two-column key/value rows with an aligned gutter. */
export function rows(entries, { indent = "  ", gap = 2 } = {}) {
  const labelWidth = entries.reduce((max, [label]) => Math.max(max, label.length), 0);
  for (const [label, value] of entries) {
    if (value === undefined || value === null) continue;
    const pad = " ".repeat(labelWidth - label.length + gap);
    line(`${indent}${style.gray(label)}${pad}${value}`);
  }
}

/** A framed block used for the job proposal and the result summary. */
export function box(title, render, { color = accent } = {}) {
  const ascii = glyph.bar === "|";
  const dash = ascii ? "-" : "─";
  const inner = Math.max(20, width() - 4);
  const fill = Math.max(3, inner - visibleLength(title) - 3);
  line(`  ${color(`${glyph.top}${dash} ${title} ${dash.repeat(fill)}`)}`);
  render((text) => line(text === undefined || text === "" ? `  ${color(glyph.bar)}` : `  ${color(glyph.bar)} ${text}`));
  line(`  ${color(`${glyph.corner}${dash.repeat(inner)}`)}`);
}

// ── spinner ─────────────────────────────────────────────────────────────────

const FRAMES_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAMES_ASCII = ["-", "\\", "|", "/"];

export function spinner(initialText = "") {
  const stream = narration();
  const interactive = Boolean(stream.isTTY);
  const frames = unicodeEnabled() ? FRAMES_UNICODE : FRAMES_ASCII;
  let index = 0;
  let text = initialText;
  let timer = null;
  let lastLength = 0;

  const paint = () => {
    const frame = style.cyan(frames[index++ % frames.length]);
    const out = `  ${frame} ${text}`;
    stream.write(`\r${" ".repeat(lastLength)}\r${out}`);
    lastLength = visibleLength(out);
  };

  // Without a TTY there is nothing to animate, so the spinner degrades to one
  // line per *state* change. Keying on the leading word rather than the whole
  // string keeps a ticking elapsed-time suffix from printing a line a second.
  let lastLogged = null;
  const stateKey = (value) => visibleLength(value) === 0 ? "" : String(value).split(/\s+/)[0];
  const log = (value) => {
    if (!value) return;
    const key = stateKey(value);
    if (key === lastLogged) return;
    lastLogged = key;
    line(`  ${glyph.dot} ${value}`);
  };

  return {
    start() {
      if (!interactive) {
        log(text);
        return this;
      }
      if (timer) return this;
      paint();
      timer = setInterval(paint, 90);
      timer.unref?.();
      return this;
    },
    update(next) {
      text = next;
      if (!interactive) {
        log(next);
        return this;
      }
      if (!timer) paint();
      return this;
    },
    stop(finalLine) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (interactive) stream.write(`\r${" ".repeat(lastLength)}\r`);
      lastLength = 0;
      if (finalLine) line(finalLine);
      return this;
    },
  };
}

// ── histograms ──────────────────────────────────────────────────────────────

/** Renders measurement counts as a sorted bar chart. */
export function histogram(counts, shots, { limit = 12, indent = "  " } = {}) {
  const entries = Object.entries(counts || {})
    .map(([bitstring, count]) => [bitstring, Number(count)])
    .filter(([, count]) => Number.isFinite(count))
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;

  const shown = entries.slice(0, limit);
  const total = shots || entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  const labelWidth = shown.reduce((max, [bits]) => Math.max(max, bits.length), 0);
  const barWidth = Math.max(10, Math.min(40, width() - labelWidth - 24));

  for (const [bits, count] of shown) {
    const share = count / total;
    const filled = Math.max(1, Math.round(share * barWidth));
    const bar = accent(glyph.block.repeat(filled)) + style.gray(glyph.dot.repeat(Math.max(0, barWidth - filled)));
    const label = `|${bits.padStart(labelWidth, " ")}${glyph.ket}`;
    const percent = `${(share * 100).toFixed(1)}%`.padStart(6, " ");
    line(`${indent}${style.cyan(label)}  ${bar}  ${String(count).padStart(6, " ")} ${style.gray(percent)}`);
  }
  if (entries.length > shown.length) {
    line(`${indent}${style.gray(`… ${entries.length - shown.length} more outcomes in the saved file`)}`);
  }
}

// ── numbers ─────────────────────────────────────────────────────────────────

export function money(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "unknown";
  return `$${Number(value).toFixed(digits)}`;
}

export function count(value) {
  return Number(value).toLocaleString("en-US");
}

export function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 100) / 10);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}
