/**
 * Branded QRouter results PDF. Drawn from the slim report context only —
 * never embeds QASM, payloads, or providerResult.
 */

import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import type { BitstringRow, JobReportContext } from "./types";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = { r: 0.039, g: 0.039, b: 0.039 };
const MUTED = { r: 0.37, g: 0.37, b: 0.37 };
const LINE = { r: 0.9, g: 0.9, b: 0.9 };
const BRAND = { r: 0.259, g: 0.898, b: 0.62 };
const TILE = { r: 0.051, g: 0.063, b: 0.055 };

type Color = { r: number; g: number; b: number };

function pdfEscape(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("™", "\\231")
    .replaceAll("©", "\\251")
    .replaceAll("—", "--")
    .replaceAll("–", "-")
    .replaceAll("’", "'")
    .replaceAll("“", "\"")
    .replaceAll("”", "\"")
    .replaceAll("⟨", "<")
    .replaceAll("⟩", ">")
    .replaceAll("·", " - ")
    .replaceAll("…", "...")
    .replace(/[^\x09\x20-\x7E\\]/g, "?");
}

function rgb(color: Color): string {
  return `${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)}`;
}

function estimateWidth(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.52 : 0.48);
}

function wrap(text: string, fontSize: number, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateWidth(next, fontSize) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatWhen(value: string | null): string {
  if (!value) return "not stored";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatPct(value: number | null): string {
  return value == null ? "--" : `${(value * 100).toFixed(2)}%`;
}

function bitLabel(row: BitstringRow): string {
  return `|${row.bitstring}>`;
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function circle(cx: number, cy: number, r: number): string {
  const k = 0.5522847498 * r;
  return [
    `${(cx + r).toFixed(2)} ${cy.toFixed(2)} m`,
    `${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c`,
    `${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c`,
    `${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c`,
    `${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c`,
    "f",
  ].join(" ");
}

function roundRect(x: number, y: number, w: number, h: number, r: number, fill: boolean): string {
  const k = 0.4477 * r;
  return [
    `${x + r} ${y} m ${x + w - r} ${y} l ${x + w - k} ${y} ${x + w} ${y + k} ${x + w} ${y + r} c`,
    `${x + w} ${y + h - r} l ${x + w} ${y + h - k} ${x + w - k} ${y + h} ${x + w - r} ${y + h} c`,
    `${x + r} ${y + h} l ${x + k} ${y + h} ${x} ${y + h - k} ${x} ${y + h - r} c`,
    `${x} ${y + r} l ${x} ${y + k} ${x + k} ${y} ${x + r} ${y} c`,
    fill ? "f" : "s",
  ].join(" ");
}

function textOp(value: string, x: number, y: number, size: number, bold: boolean, color: Color, align: "left" | "right" = "left"): string {
  const width = estimateWidth(value, size, bold);
  const tx = align === "right" ? x - width : x;
  return [
    "BT",
    `${rgb(color)} rg`,
    `/${bold ? "F2" : "F1"} ${size} Tf`,
    `1 0 0 1 ${tx.toFixed(2)} ${y.toFixed(2)} Tm`,
    `(${pdfEscape(value)}) Tj`,
    "ET",
  ].join(" ");
}

function headerOps(): string {
  const x = MARGIN;
  const top = PAGE_H - 36;
  const size = 18;
  const ox = x + 2;
  const oy = top - size + 2;
  return [
    `${rgb(TILE)} rg`,
    roundRect(x, top - size, size, size, 4, true),
    `${rgb(BRAND)} RG 1.7 w 1 J 1 j`,
    `${ox} ${oy + 5.4} m ${ox + 4.6} ${oy + 5.4} l ${ox + 6} ${oy + 6.8} l ${ox + 6} ${oy + 10.4} l ${ox + 7.4} ${oy + 11.8} l ${ox + 11.2} ${oy + 11.8} l ${ox + 12.6} ${oy + 10.4} l ${ox + 12.6} ${oy + 1.2} l S`,
    `${rgb(BRAND)} rg ${circle(ox + 12.6, oy + 5.4, 1.25)}`,
    textOp("QRouter\u2122", x + 26, top - 8, 13, true, INK),
    textOp("Results report", x + 26, top - 20, 8, false, MUTED),
    `${rgb(LINE)} RG 0.6 w ${x} ${top - 28} m ${x + CONTENT_W} ${top - 28} l S`,
  ].join("\n");
}

function footerOps(left: string, right: string, page: number, total: number): string {
  const label = `${right}   ${page} / ${total}`;
  return [
    `${rgb(LINE)} RG 0.6 w ${MARGIN} 36 m ${MARGIN + CONTENT_W} 36 l S`,
    textOp(left, MARGIN, 28, 7, false, MUTED),
    textOp(label, MARGIN + CONTENT_W, 28, 7, false, MUTED, "right"),
  ].join("\n");
}

class ReportPainter {
  pages: string[] = [];
  private ops: string[] = [];
  y = PAGE_H - 92;

  constructor() {
    this.ops.push(headerOps());
  }

  private flushPage() {
    this.pages.push(this.ops.join("\n"));
    this.ops = [headerOps()];
    this.y = PAGE_H - 92;
  }

  private ensure(space: number) {
    if (this.y - space < 56) this.flushPage();
  }

  private add(...chunks: string[]) {
    this.ops.push(...chunks);
  }

  heading(label: string) {
    this.ensure(28);
    this.y -= 4;
    this.add(textOp(label.toUpperCase(), MARGIN, this.y, 8, true, MUTED));
    this.y -= 14;
  }

  paragraph(text: string, size = 9.5) {
    for (const line of wrap(text, size, CONTENT_W)) {
      this.ensure(14);
      this.add(textOp(line, MARGIN, this.y, size, false, INK));
      this.y -= 13;
    }
    this.y -= 4;
  }

  metrics(items: Array<{ label: string; value: string }>) {
    const cols = 4;
    const gap = 8;
    const w = (CONTENT_W - gap * (cols - 1)) / cols;
    const h = 36;
    items.forEach((item, index) => {
      if (index % cols === 0) this.ensure(h + 10);
      const col = index % cols;
      if (col === 0 && index > 0) this.y -= h + gap;
      const x = MARGIN + col * (w + gap);
      const y = this.y - h;
      this.add(`${rgb(LINE)} RG 0.6 w`, roundRect(x, y, w, h, 3, false));
      this.add(textOp(item.label.toUpperCase(), x + 8, y + 22, 6.5, true, MUTED));
      this.add(textOp(item.value.slice(0, 28), x + 8, y + 9, 10, true, INK));
    });
    this.y -= h + 12;
  }

  chart(rows: BitstringRow[]) {
    if (!rows.length) return;
    const shown = rows.slice(0, 16);
    const max = Math.max(...shown.map((row) => row.count ?? row.probability ?? 0), 1e-9);
    const barH = 12;
    const gap = 6;
    const labelW = 78;
    shown.forEach((row) => {
      this.ensure(barH + gap);
      const y = this.y - barH;
      const value = row.count ?? row.probability ?? 0;
      const barW = Math.max(2, ((CONTENT_W - labelW - 64) * value) / max);
      this.add(textOp(bitLabel(row), MARGIN, y + 2, 8, false, MUTED));
      this.add(`${rgb(INK)} rg ${MARGIN + labelW} ${y} ${barW.toFixed(2)} ${barH} re f`);
      const caption = row.count != null ? `${row.count}  ${formatPct(row.probability)}` : formatPct(row.probability);
      this.add(textOp(caption, MARGIN + labelW + barW + 6, y + 2, 7.5, false, MUTED));
      this.y -= barH + gap;
    });
    this.y -= 6;
  }

  table(rows: BitstringRow[]) {
    if (!rows.length) return;
    this.ensure(20);
    this.add(
      textOp("Bitstring", MARGIN, this.y, 7, true, MUTED),
      textOp("Count", MARGIN + 220, this.y, 7, true, MUTED),
      textOp("Probability", MARGIN + 320, this.y, 7, true, MUTED),
    );
    this.y -= 12;
    for (const row of rows.slice(0, 16)) {
      this.ensure(14);
      this.add(
        textOp(bitLabel(row), MARGIN, this.y, 9, false, INK),
        textOp(row.count != null ? row.count.toLocaleString() : "--", MARGIN + 220, this.y, 9, false, INK),
        textOp(formatPct(row.probability), MARGIN + 320, this.y, 9, false, INK),
      );
      this.y -= 13;
    }
    this.y -= 6;
  }

  close(): string[] {
    this.pages.push(this.ops.join("\n"));
    return this.pages;
  }
}

function assemblePdf(pageStreams: string[]): Uint8Array {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "placeholder-pages",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  const pageIds: number[] = [];
  for (const stream of pageStreams) {
    const body = `${stream}\n`;
    objects.push(`<< /Length ${Buffer.byteLength(body, "utf8")} >>\nstream\n${body}endstream`);
    const contentId = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ProcSet [/PDF /Text] >> >>`,
    );
    pageIds.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks: string[] = ["%PDF-1.4\n"];
  const xref: number[] = [0];
  let offset = Buffer.byteLength(chunks[0], "utf8");
  objects.forEach((object, index) => {
    const body = `${index + 1} 0 obj\n${object}\nendobj\n`;
    xref.push(offset);
    chunks.push(body);
    offset += Buffer.byteLength(body, "utf8");
  });
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    table += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  }
  chunks.push(table);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "utf8");
}

export function buildReportPdf(context: JobReportContext): Uint8Array {
  const job = context.job;
  const analytics = context.analytics;
  const painter = new ReportPainter();

  painter.metrics([
    { label: "Status", value: job.status.replaceAll("_", " ") },
    { label: "Backend", value: job.backendName || "--" },
    { label: "Qubits", value: job.qubits != null ? String(job.qubits) : "--" },
    { label: "Depth", value: job.depth != null ? String(job.depth) : "--" },
    { label: "Shots", value: (analytics.shotsObserved ?? job.shots)?.toLocaleString() ?? "--" },
    { label: "Cost", value: job.cost != null ? `$${job.cost.toFixed(4)}` : "--" },
    { label: "Duration", value: formatDuration(job.durationMs) },
    { label: "Job", value: job.id.slice(0, 8) },
  ]);

  painter.heading("Job");
  painter.paragraph(
    [job.name || "Untitled task", job.id, job.backendKind ? `${job.backendName} (${job.backendKind})` : job.backendName, `Created ${formatWhen(job.createdAt)}`, `Completed ${formatWhen(job.completedAt)}`]
      .filter(Boolean)
      .join("  |  "),
    9,
  );

  painter.heading("Results");
  if (!analytics.available) {
    painter.paragraph(analytics.reason ?? "This job has no measurement results yet.");
  } else {
    if (analytics.shannonEntropyBits != null) {
      painter.paragraph(`Shannon entropy of the shot histogram: ${analytics.shannonEntropyBits.toFixed(3)} bits. Distinct bitstrings: ${analytics.distinctStates}.`);
    } else if (analytics.probabilityEntropyBits != null) {
      painter.paragraph(`Entropy of the stored probability distribution: ${analytics.probabilityEntropyBits.toFixed(3)} bits. Shot-histogram entropy is not available.`);
    }
    if (analytics.fidelity != null) painter.paragraph(`Stored fidelity: ${analytics.fidelity}`);
    if (analytics.stderr != null) painter.paragraph(`Stored stderr: ${analytics.stderr}`);
    if (analytics.notes.length) painter.paragraph(analytics.notes.join(" "));
    painter.heading("Distribution");
    painter.chart(analytics.histogram);
    painter.heading("Top bitstrings");
    painter.table(analytics.top);
    if (analytics.expected?.length) {
      painter.heading("Expected (from stored metadata)");
      painter.table(analytics.expected);
    }
  }

  if (context.transpile && (context.transpile.depthFrom != null || context.transpile.depthTo != null)) {
    const t = context.transpile;
    painter.heading("Compilation");
    painter.paragraph(
      [
        t.depthFrom != null && t.depthTo != null ? `Depth ${t.depthFrom} -> ${t.depthTo}` : null,
        t.gatesFrom != null && t.gatesTo != null ? `Gates ${t.gatesFrom} -> ${t.gatesTo}` : null,
        t.equivalent == null ? null : t.equivalent ? "Verified equivalent" : "Equivalence not confirmed",
      ].filter(Boolean).join("  |  ") || "Compilation metrics were stored without before/after figures.",
    );
  }

  if (analytics.measurementMap.length) {
    painter.heading("Measurement map");
    painter.paragraph(analytics.measurementMap.slice(0, 24).map((pair) => `q${pair.qubit} -> c${pair.clbit}`).join("   "));
  }

  painter.heading("QRouter brief");
  painter.paragraph(context.narrative?.text ?? "Narrative was not generated for this report.");
  painter.paragraph(
    `Trademark: QRouter\u2122. ${PUBLIC_CONFIG.copyright}. Narrative cites only stored results (hash ${context.hash.slice(0, 12)}).`,
    8,
  );

  const footerLeft = `${PUBLIC_CONFIG.copyright}  QRouter\u2122`;
  const footerRight = job.id.slice(0, 8);
  const pages = painter.close().map((body, index, all) => `${body}\n${footerOps(footerLeft, footerRight, index + 1, all.length)}`);
  return assemblePdf(pages);
}

export function pdfFileName(jobId: string): string {
  const short = jobId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "job";
  return `qrouter-report-${short}.pdf`;
}
