// Streaming markdown → terminal renderer.
//
// The assistant streams tokens, so rendering is line-buffered: a line is
// formatted and printed the moment its newline arrives, and the trailing
// fragment waits. That keeps output live without ever re-printing a line it
// already emitted (which is what makes naive re-render approaches flicker).
//
// It also owns one QRouter-specific job: a ```qrouter-proposal fence is a job
// the user is being asked to approve, not prose. Those lines are captured and
// withheld so the caller can render a confirmation card instead.

import { accent, glyph, style, visibleLength, wrapText, width } from "./ui.mjs";

const PROPOSAL_LANGUAGE = "qrouter-proposal";

/** Applies inline marks: **bold**, *italic*, `code`, [label](url). */
export function renderInline(text) {
  const source = String(text).replace(/\\([*_`~])/g, "$1");
  let out = "";
  const pattern = /(\*\*[^*]+\*\*|(?<![\w*])\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    out += source.slice(last, match.index);
    const token = match[0];
    if (token.startsWith("**")) out += style.bold(token.slice(2, -2));
    else if (token.startsWith("`")) out += accent(token.slice(1, -1));
    else if (token.startsWith("[")) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      // Terminal links are not clickable, so the URL is shown, not hidden.
      out += link ? `${style.bold(link[1])} ${style.gray(`(${link[2]})`)}` : token;
    } else out += style.italic(token.slice(1, -1));
    last = match.index + token.length;
  }
  out += source.slice(last);
  return out;
}

function renderTable(rows, emit, indent) {
  const cells = rows
    .map((row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()))
    .filter((row) => !row.every((cell) => /^:?-{2,}:?$/.test(cell)));
  if (cells.length === 0) return;

  const columns = Math.max(...cells.map((row) => row.length));
  const widths = [];
  for (let column = 0; column < columns; column += 1) {
    widths[column] = Math.min(
      34,
      Math.max(...cells.map((row) => visibleLength(renderInline(row[column] ?? "")))),
    );
  }
  cells.forEach((row, index) => {
    const rendered = row
      .map((cell, column) => {
        const text = renderInline(cell);
        const pad = " ".repeat(Math.max(0, widths[column] - visibleLength(text)));
        return index === 0 ? style.bold(text) + pad : text + pad;
      })
      .join(style.gray("  "));
    emit(`${indent}${rendered}`);
    if (index === 0) {
      emit(`${indent}${style.gray(widths.map((size) => "-".repeat(size)).join("  "))}`);
    }
  });
}

/**
 * Creates a renderer that consumes streamed markdown and emits terminal lines.
 *
 * @param {(line: string) => void} emit called once per finished output line
 * @param {{ indent?: string, columns?: number }} [options]
 */
export function createMarkdownStream(emit, options = {}) {
  const indent = options.indent ?? "  ";
  const columns = options.columns ?? width();
  let pending = "";
  let fence = null; // { language, lines }
  let table = [];
  let proposalRaw = "";
  let lastBlank = true; // suppress leading blank lines

  const out = (text = "") => {
    if (text === "") {
      if (lastBlank) return;
      lastBlank = true;
    } else {
      lastBlank = false;
    }
    emit(text);
  };

  const flushTable = () => {
    if (table.length === 0) return;
    renderTable(table, out, indent);
    table = [];
  };

  const renderLine = (raw) => {
    const text = raw.replace(/\s+$/, "");

    // fences
    const fenceMatch = /^\s*```(.*)$/.exec(text);
    if (fenceMatch) {
      if (fence) {
        if (fence.language === PROPOSAL_LANGUAGE) proposalRaw = fence.lines.join("\n");
        fence = null;
      } else {
        flushTable();
        fence = { language: fenceMatch[1].trim().toLowerCase(), lines: [] };
        if (fence.language !== PROPOSAL_LANGUAGE) {
          out("");
          if (fence.language) out(`${indent}${style.gray(fence.language)}`);
        }
      }
      return;
    }
    if (fence) {
      fence.lines.push(text);
      if (fence.language !== PROPOSAL_LANGUAGE) out(`${indent}${accent(text)}`);
      return;
    }

    // tables
    if (/^\s*\|.*\|\s*$/.test(text)) {
      table.push(text.trim());
      return;
    }
    flushTable();

    if (!text.trim()) {
      out("");
      return;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(text);
    if (heading) {
      out("");
      out(`${indent}${style.bold(renderInline(heading[2]))}`);
      return;
    }

    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(text);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2);
      const lead = `${indent}${"  ".repeat(depth)}${style.gray(glyph.bullet)} `;
      const hanging = " ".repeat(visibleLength(lead));
      const wrapped = wrapText(renderInline(bullet[2]), columns - visibleLength(lead), "");
      wrapped.forEach((part, index) => out(`${index === 0 ? lead : hanging}${part}`));
      return;
    }

    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(text);
    if (ordered) {
      const lead = `${indent}${style.gray(`${ordered[2]}.`)} `;
      const hanging = " ".repeat(visibleLength(lead));
      const wrapped = wrapText(renderInline(ordered[3]), columns - visibleLength(lead), "");
      wrapped.forEach((part, index) => out(`${index === 0 ? lead : hanging}${part}`));
      return;
    }

    const quote = /^\s*>\s?(.*)$/.exec(text);
    if (quote) {
      out(`${indent}${style.gray(glyph.bar)} ${style.gray(renderInline(quote[1]))}`);
      return;
    }

    for (const part of wrapText(renderInline(text), columns - indent.length, "")) {
      out(`${indent}${part}`);
    }
  };

  return {
    /** Feed streamed text; complete lines render immediately. */
    push(chunk) {
      pending += String(chunk).replace(/\r\n/g, "\n");
      let index;
      while ((index = pending.indexOf("\n")) !== -1) {
        const raw = pending.slice(0, index);
        pending = pending.slice(index + 1);
        renderLine(raw);
      }
    },
    /** Renders whatever is left and reports a captured proposal, if any. */
    end() {
      if (pending.length) {
        renderLine(pending);
        pending = "";
      }
      if (fence) {
        // An unterminated fence still carries a usable payload.
        if (fence.language === PROPOSAL_LANGUAGE) proposalRaw = fence.lines.join("\n");
        fence = null;
      }
      flushTable();
      return { proposalRaw: proposalRaw || null };
    },
  };
}

/** Non-streaming convenience wrapper, used by tests and by `/history`. */
export function renderMarkdown(text, options = {}) {
  const lines = [];
  const stream = createMarkdownStream((value) => lines.push(value), options);
  stream.push(text);
  const { proposalRaw } = stream.end();
  return { text: lines.join("\n"), proposalRaw };
}
