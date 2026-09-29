"use client";

// ─────────────────────────────────────────────────────────────────────────────
// QRouter console assistant.
//
// The main dashboard surface: a Gemini-reasoned chat that answers hardware /
// pricing / repo questions and prepares quantum jobs. Key behaviors:
//   · particle-typography welcome (reuses the landing QuantumParticles)
//   · SSE streaming with a live, collapsible "Reasoning" block (Claude-style)
//   · ```qrouter-proposal``` blocks render as a confirmation card that fetches
//     a REAL engine quote (/api/chat/quote), checks the credit balance, and
//     only submits through /api/v1/jobs after an explicit "Run job" click
//   · thread memory via /api/chat (graceful when the migration isn't run yet)
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  CircleStop,
  Loader2,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import LogoMark from "@/components/LogoMark";
import GetStartedPanel from "@/components/chat/GetStartedPanel";
import { EncodingDeepDive, EncodingOverview, EncodingStageStrip, overlayExecute, type CompileMetrics, type EncodingCandidate } from "@/components/encoding/EncodingProcess";
import { getBackend } from "@/lib/qrouter/catalog";
import { proposalIdempotencyKey, splitChatProposals, type ChatProposal } from "@/lib/qrouter/chatProposals";
import { costView, formatUsd } from "@/lib/qrouter/cost";
import { formatDuration } from "@/lib/qrouter/duration";
import { isSettled, statusView } from "@/lib/qrouter/status";
import { useAdvance } from "@/lib/client/use-advance";
import { onVisibleInterval } from "@/lib/client/visible-interval";

/** Backend ids are stable storage keys; show the human name where one exists. */
const backendLabel = (id: string) => getBackend(id)?.displayName ?? id;

// ── types ────────────────────────────────────────────────────────────────────

interface ThreadRow {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatMsg {
  id?: number;
  key: string;
  role: "user" | "assistant";
  content: string;
  thoughts: string;
  status: "streaming" | "done" | "error";
  error?: string;
  startedAt: number;
  thoughtMs?: number;
}

const SUGGESTIONS = [
  "Compare IBM Brisbane and IonQ Aria for a 12-qubit variational circuit.",
  "What qubit count do I need for QAOA on a 20-node Max-Cut problem?",
  "What would 4,096 shots of a Bell state cost right now?",
  "Run a Bell state with 1,024 shots on the best available backend.",
];

// ── the routing chip ─────────────────────────────────────────────────────────
//
// Pressing a provider on the routing tab lands here with that provider already
// chosen, shown as one atomic blue block at the head of the composer.
//
// It is a sibling of the textarea rather than text inside it, which is what
// makes "atomic" true rather than simulated: there is no way to land a caret
// inside it, select half of it, or type into the middle of it, because none of
// it is in the text buffer. The one thing that has to be wired by hand is
// Backspace at offset zero, below — the gesture that would delete the previous
// character if the chip were text takes the whole chip instead.

/** Exactly the sentence the chip reads, and exactly what gets sent. */
const chipText = (provider: string) => `Route task using "${provider}"`;

/** Shown in place of the normal composer hint once a chip is in play — the
    chip has already said which machine, so this asks for the rest. */
const CHIP_PLACEHOLDER = "…add what to run, from where, and any limits";

/** Example prompts under the welcome line. Clicking one sends it. */
function ExamplePrompts({
  items,
  onPick,
  disabled,
}: {
  items: readonly string[];
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <ul className="qc-examples" aria-label="Example requests">
      {items.map((text) => (
        <li key={text}>
          <button type="button" onClick={() => onPick(text)} disabled={disabled}>
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── markdown-lite ────────────────────────────────────────────────────────────

function renderInline(raw: string, keyBase: string): ReactNode[] {
  const text = raw.replace(/\\([*_`~])/g, "$1"); // unescape \* \_ \` \~
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) out.push(<strong key={`${keyBase}-b${i}`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={`${keyBase}-i${i}`}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("`")) out.push(<code key={`${keyBase}-c${i}`}>{token.slice(1, -1)}</code>);
    else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (link)
        out.push(
          <a key={`${keyBase}-l${i}`} href={link[2]} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>,
        );
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Tiny markdown renderer: headings, bullets, tables, fences, inline marks. */
function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => text.split(/```/), [text]);
  return (
    <div className="qc-md">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const newline = block.indexOf("\n");
          const lang = newline === -1 ? "" : block.slice(0, newline).trim();
          const code = newline === -1 ? "" : block.slice(newline + 1).replace(/\n$/, "");
          return (
            <pre key={index} className="qc-code">
              {lang && <span>{lang}</span>}
              <code>{code}</code>
            </pre>
          );
        }
        const lines = block.split("\n");
        const nodes: ReactNode[] = [];
        let list: string[] = [];
        let table: string[] = [];
        const flushList = () => {
          if (list.length === 0) return;
          nodes.push(
            <ul key={`ul-${index}-${nodes.length}`}>
              {list.map((item, j) => (
                <li key={j}>{renderInline(item, `${index}-${j}`)}</li>
              ))}
            </ul>,
          );
          list = [];
        };
        const flushTable = () => {
          if (table.length === 0) return;
          const rows = table
            .map((row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
            .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
          nodes.push(
            <div className="qc-table-wrap" key={`t-${index}-${nodes.length}`}>
              <table>
                <tbody>
                  {rows.map((cells, r) => (
                    <tr key={r}>
                      {cells.map((cell, c) =>
                        r === 0 ? (
                          <th key={c}>{renderInline(cell, `${index}-t${r}${c}`)}</th>
                        ) : (
                          <td key={c}>{renderInline(cell, `${index}-t${r}${c}`)}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          table = [];
        };
        for (const raw of lines) {
          const line = raw.trimEnd();
          if (/^\s*\|.*\|\s*$/.test(line)) {
            flushList();
            table.push(line.trim());
            continue;
          }
          flushTable();
          const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
          if (bullet) {
            list.push(bullet[1]);
            continue;
          }
          flushList();
          if (!line.trim()) continue;
          const heading = /^(#{1,4})\s+(.*)$/.exec(line);
          if (heading) {
            nodes.push(<h4 key={`h-${index}-${nodes.length}`}>{renderInline(heading[2], `${index}-h`)}</h4>);
            continue;
          }
          nodes.push(<p key={`p-${index}-${nodes.length}`}>{renderInline(line, `${index}-p${nodes.length}`)}</p>);
        }
        flushList();
        flushTable();
        return <div key={index}>{nodes}</div>;
      })}
    </div>
  );
}

// ── proposal extraction ─────────────────────────────────────────────────────

// ── job confirmation card ───────────────────────────────────────────────────

interface QuoteState {
  status: "loading" | "ready" | "error";
  message?: string;
  circuit?: string;
  format?: "openqasm2" | "openqasm3";
  backend?: string;
  backendId?: string;
  queueSeconds?: number;
  total?: number;
  analysis?: { qubits: number; depth: number; complexity: string };
  encoding?: import("@/lib/qrouter/encoding/types").EncodingTrace;
  explanation?: string[];
  candidates?: EncodingCandidate[];
  transpilation?: CompileMetrics;
}

function JobProposalCard({
  proposal,
  balance,
  messageId,
  proposalIndex,
}: {
  proposal: ChatProposal;
  balance: number | null;
  messageId?: number;
  proposalIndex: number;
}) {
  const [quote, setQuote] = useState<QuoteState>({ status: "loading" });
  const [phase, setPhase] = useState<"review" | "running" | "done" | "failed" | "dismissed">("review");
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [historyChecked, setHistoryChecked] = useState(!messageId);
  // Wall-clock for this run: `runStartedAt` is stamped on confirm, `runMs` is
  // frozen when the job settles so the card keeps reporting the real duration.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runMs, setRunMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const shots = proposal.shots ?? 1024;
  const stableIdempotencyKey = messageId === undefined ? null : proposalIdempotencyKey(messageId, proposalIndex);

  // Ticks only while a job is in flight.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const liveMs = runMs ?? (runStartedAt === null ? null : Date.now() - runStartedAt);
  void tick; // the interval above is what re-renders the elapsed readout

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let circuit = proposal.circuit ?? "";
        let format = proposal.format ?? "openqasm2";
        if (!circuit && proposal.repository) {
          const params = new URLSearchParams({
            repository: proposal.repository.url,
            path: proposal.repository.path,
          });
          if (proposal.repository.ref) params.set("ref", proposal.repository.ref);
          const res = await fetch(`/api/chat/circuit?${params}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error?.message ?? "Could not load the repository circuit.");
          circuit = data.circuit;
          format = data.format;
        }
        if (!circuit) throw new Error("The proposal is missing a circuit.");
        const res = await fetch("/api/chat/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            circuit,
            format,
            shots,
            target: proposal.target ?? "auto",
            routing_mode: proposal.routing_mode ?? "balanced",
            constraints: proposal.constraints ?? {},
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message ?? "Quoting failed.");
        if (cancelled) return;
        setQuote({
          status: "ready",
          circuit,
          format,
          backend: data.decision.selected.displayName,
          backendId: data.decision.selected.id,
          queueSeconds: data.decision.selected.queueSeconds,
          total: data.quote.total,
          analysis: data.analysis,
          encoding: data.encoding ?? data.decision?.encoding,
          explanation: data.decision?.explanation,
          candidates: data.decision?.candidates,
          transpilation: data.transpilation
            ? { before: data.transpilation.before, after: data.transpilation.after }
            : undefined,
        });
      } catch (error) {
        if (!cancelled)
          setQuote({ status: "error", message: error instanceof Error ? error.message : "Quoting failed." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A proposal card is reconstructed from persisted assistant text whenever a
  // chat is reopened. Ask the server whether this exact message-position was
  // already submitted before enabling the confirmation button. The server also
  // recognizes legacy runs created before stable proposal keys were introduced.
  useEffect(() => {
    if (!messageId || !stableIdempotencyKey || quote.status !== "ready" || !quote.circuit) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/proposal-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messageId,
            idempotencyKey: stableIdempotencyKey,
            name: proposal.name,
            circuit: quote.circuit,
            shots,
            target: proposal.target ?? "auto",
            routing_mode: proposal.routing_mode ?? "balanced",
          }),
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setResult(runResultFrom(data));
          setPhase("done");
        }
      } catch {
        // A status outage must not break chat. The stable idempotency key used
        // below still prevents a second charge if the user retries.
      } finally {
        if (!cancelled) setHistoryChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId, proposal.name, proposal.routing_mode, proposal.target, quote, shots, stableIdempotencyKey]);

  async function run() {
    if (quote.status !== "ready" || !quote.circuit) return;
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    setRunMs(null);
    setPhase("running");
    setRunError(null);
    try {
      const res = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": stableIdempotencyKey ?? crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: proposal.name ?? "Assistant task",
          circuit: quote.circuit,
          format: quote.format,
          shots,
          target: proposal.target ?? "auto",
          routing_mode: proposal.routing_mode ?? "balanced",
          constraints: proposal.constraints ?? {},
        }),
      });
      const data = await res.json();
      // 402 parks the job rather than rejecting it: it starts on its own once
      // credits are added, so the card keeps following it.
      if (res.status === 402 && data.error?.job_id) {
        setResult({
          id: data.error.job_id,
          status: "awaiting_payment",
          backend: quote.backendId ?? proposal.target ?? "auto",
          total: typeof data.error.quote?.total === "number" ? data.error.quote.total : quote.total,
          charged: null,
        });
        setRunMs(Date.now() - startedAt);
        setPhase("done");
        return;
      }
      if (!res.ok) throw new Error(data.error?.message ?? "Job submission failed.");
      setResult(runResultFrom(data));
      setRunMs(Date.now() - startedAt);
      setPhase("done");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Job submission failed.");
      setRunMs(Date.now() - startedAt);
      setPhase("failed");
    }
  }

  // Follow the submitted job until it settles, driving it forward if no
  // scheduler is running.
  const followId = result && !isSettled(result.status) ? result.id : null;
  useEffect(() => {
    if (!followId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${followId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const next = runResultFrom(await res.json());
        if (!cancelled) setResult((current) => (current?.id === next.id ? { ...current, ...next } : current));
      } catch {
        /* next tick retries */
      }
    };
    const stop = onVisibleInterval(poll, 3000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [followId]);
  useAdvance(result ? [result] : []);

  if (phase === "dismissed") {
    return <div className="qc-proposal dismissed"><X size={13} /> Proposal dismissed — nothing was run.</div>;
  }

  const storedCounts = Object.entries(result?.counts ?? {})
    .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const peakCount = Math.max(...storedCounts.map(([, count]) => count), 0);

  const insufficient =
    quote.status === "ready" && balance !== null && typeof quote.total === "number" && quote.total > balance;

  return (
    <div className="qc-proposal">
      <header>
        <b>Job proposal</b>
        <span>
          {!historyChecked
            ? "checking previous run"
            : phase === "done"
              ? "already confirmed"
              : phase === "running"
                ? "confirmed"
                : "requires your confirmation"}
        </span>
      </header>

      {proposal.note && <p className="qc-proposal-note">{proposal.note}</p>}

      <dl>
        <div>
          <dt>Circuit</dt>
          <dd>
            {proposal.repository
              ? `${proposal.repository.path} · ${proposal.repository.url.replace(/^https?:\/\/(www\.)?github\.com\//i, "")}`
              : quote.analysis
                ? `inline · ${quote.analysis.qubits}q · depth ${quote.analysis.depth}`
                : "inline OpenQASM"}
          </dd>
        </div>
        <div><dt>Shots</dt><dd>{shots.toLocaleString()}</dd></div>
        <div><dt>Routing</dt><dd><span className="capitalize">{proposal.routing_mode ?? "balanced"}</span> · {backendLabel(proposal.target ?? "auto")}</dd></div>
        <div>
          <dt>Backend</dt>
          <dd>
            {quote.status === "loading" && <span className="qc-quote-loading"><Loader2 size={12} className="spin" /> routing…</span>}
            {quote.status === "ready" && quote.backend}
            {quote.status === "error" && "—"}
          </dd>
        </div>
        <div>
          <dt>QRouter quote</dt>
          <dd>
            {quote.status === "loading" && <span className="qc-quote-loading"><Loader2 size={12} className="spin" /> quoting…</span>}
            {quote.status === "ready" && <b className="qc-quote-total">${quote.total?.toFixed(4)}</b>}
            {quote.status === "error" && "unavailable"}
          </dd>
        </div>
        <div>
          <dt>Credits</dt>
          <dd className={insufficient ? "qc-danger" : undefined}>
            {balance === null ? "unknown" : `$${balance.toFixed(2)} available`}
          </dd>
        </div>
      </dl>

      {quote.status === "error" && (
        <p className="qc-proposal-error"><AlertCircle size={13} /> {quote.message}</p>
      )}
      {insufficient && (
        <p className="qc-proposal-error">
          <AlertCircle size={13} /> The quote exceeds your available credits.{" "}
          <Link href="/dashboard/billing">Add credits</Link> before running.
        </p>
      )}
      {phase === "failed" && runError && (
        <p className="qc-proposal-error"><AlertCircle size={13} /> {runError}</p>
      )}

      {quote.status === "loading" && (
        <div className="qc-encoding">
          <p className="qc-encoding-pending">Analyzing the circuit, compiling it, and choosing a backend…</p>
          <EncodingStageStrip stages={overlayExecute(undefined)} compact />
        </div>
      )}
      {quote.status === "ready" && phase === "review" && (
        <div className="qc-encoding">
          <EncodingOverview
            encoding={quote.encoding}
            candidates={quote.candidates}
            explanation={quote.explanation}
            selectedId={quote.backendId}
            transpilation={quote.transpilation}
            quoteTotal={quote.total ?? null}
            density="process"
          />
          <EncodingStageStrip
            stages={overlayExecute(quote.encoding?.stages)}
            compact
            encoding={quote.encoding}
            transpilation={quote.transpilation}
            candidates={quote.candidates}
            selectedId={quote.backendId}
          />
          <details className="qc-encoding-detail">
            <summary>How encoding and routing chose this</summary>
            <EncodingDeepDive
              encoding={quote.encoding}
              stages={overlayExecute(quote.encoding?.stages)}
              candidates={quote.candidates}
              explanation={quote.explanation}
              selectedId={quote.backendId}
              transpilation={quote.transpilation}
              quoteTotal={quote.total ?? null}
              surface="tabs"
            />
          </details>
        </div>
      )}

      {/* Live processing readout — stages come from the real encoding trace. */}
      {phase === "running" && (
        <div className="qc-progress">
          <span className="qc-elapsed running"><Loader2 size={12} className="spin" /> {formatDuration(liveMs)}</span>
          <EncodingStageStrip
            stages={overlayExecute(quote.status === "ready" ? quote.encoding?.stages : undefined, "dispatching")}
            compact
            encoding={quote.status === "ready" ? quote.encoding : undefined}
            transpilation={quote.status === "ready" ? quote.transpilation : undefined}
            candidates={quote.status === "ready" ? quote.candidates : undefined}
            selectedId={quote.status === "ready" ? quote.backendId : undefined}
          />
        </div>
      )}
      {phase === "failed" && runMs !== null && (
        <div className="qc-progress">
          <span className="qc-elapsed failed">failed after {formatDuration(runMs)}</span>
        </div>
      )}

      {phase === "done" && result ? (
        <div className="qc-run-result">
          <RunSummary result={result} runMs={runMs} />
          {storedCounts.length ? (
            <div className="qc-counts" role="img" aria-label={`Top ${storedCounts.length} stored bitstrings`}>
              {storedCounts.map(([state, count]) => (
                <div key={state}>
                  <code>|{state}⟩</code>
                  <i style={{ width: `${Math.max(4, peakCount > 0 ? (count / peakCount) * 100 : 4)}%` }} />
                  <b>{count.toLocaleString()}</b>
                </div>
              ))}
            </div>
          ) : result.status === "completed" ? (
            <p className="qc-run-empty">No measurement counts were stored.</p>
          ) : null}
          <div className="qc-run-actions">
            {result.status === "completed" && (
              <a href={`/api/v1/jobs/${result.id}/result`} download={`job-${result.id}.json`}>
                Download JSON
              </a>
            )}
            {result.status === "awaiting_payment" && <Link href="/dashboard/billing">Add credits</Link>}
            <Link href={`/dashboard/activity?job=${result.id}`}>Open in Activity</Link>
          </div>
        </div>
      ) : (
        <footer>
          <button
            type="button"
            className="qc-run"
            onClick={run}
            disabled={!historyChecked || quote.status !== "ready" || phase === "running" || insufficient}
          >
            {!historyChecked
              ? <><Loader2 size={14} className="spin" /> Checking previous run…</>
              : phase === "running"
                ? <><Loader2 size={14} className="spin" /> Routing &amp; executing…</>
                : <>Confirm &amp; run</>}
          </button>
          <button type="button" className="qc-dismiss" onClick={() => setPhase("dismissed")} disabled={phase === "running"}>
            Dismiss
          </button>
          <small>Charged against credits only after this confirmation.</small>
        </footer>
      )}
    </div>
  );
}

type RunResult = {
  id: string;
  status: string;
  backend: string;
  counts?: Record<string, number>;
  total?: number;
  charged?: number | null;
};

function runResultFrom(data: Record<string, unknown> & { result?: { counts?: Record<string, number> } | null; quote?: { total?: unknown } | null }): RunResult {
  const total = Number(data.quote?.total);
  return {
    id: String(data.id),
    status: String(data.status),
    backend: String(data.selected_backend_id ?? ""),
    counts: data.result?.counts,
    total: Number.isFinite(total) ? total : undefined,
    charged: typeof data.charged === "number" ? data.charged : null,
  };
}

function RunSummary({ result, runMs }: { result: RunResult; runMs: number | null }) {
  const view = statusView(result.status);
  const cost = costView({ status: result.status, quoted: result.total, charged: result.charged });
  const pending = !isSettled(result.status);
  return (
    <p className="qc-run-summary">
      {pending ? <Loader2 size={13} className="spin" /> : result.status === "completed" ? <Check size={13} /> : <AlertCircle size={13} />}
      <span className={`qc-run-status ${view.tone}`}>{view.label}</span>
      {result.backend && <> on <b>{backendLabel(result.backend)}</b></>}
      <span className="qc-run-meta">
        {cost.label}
        {cost.amount !== null && <> <b>{formatUsd(cost.amount)}</b></>}
        {cost.secondary && <> ({cost.secondary})</>}
        {runMs !== null && !pending && <> · submitted in {formatDuration(runMs)}</>}
      </span>
      {result.status === "awaiting_payment" && (
        <span className="qc-run-meta">Starts automatically once credits are added.</span>
      )}
    </p>
  );
}

// ── thinking block ──────────────────────────────────────────────────────────

function ThinkingBlock({ msg }: { msg: ChatMsg }) {
  const activelyThinking = msg.status === "streaming" && msg.content.length === 0;
  const [open, setOpen] = useState(false);
  const seconds = ((msg.thoughtMs ?? 0) / 1000).toFixed(1);

  if (!msg.thoughts) return null;
  const expanded = open || activelyThinking;

  return (
    <div className={`qc-thinking ${activelyThinking ? "live" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded}>
        <i className="qc-orbit" aria-hidden="true" />
        {activelyThinking ? "Reasoning…" : `Reasoned for ${seconds}s`}
        <span>{expanded ? "hide" : "show"}</span>
      </button>
      {expanded && (
        <div className="qc-thinking-body">
          <Markdown text={msg.thoughts} />
        </div>
      )}
    </div>
  );
}

// ── main component ──────────────────────────────────────────────────────────

export default function QuantumChat({
  userName,
  balance,
  showGetStarted = false,
  routeProvider = null,
}: {
  userName: string;
  balance: number | null;
  showGetStarted?: boolean;
  /** Provider chosen on the routing tab, already validated server-side. */
  routeProvider?: string | null;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [input, setInput] = useState("");
  const [chip, setChip] = useState<string | null>(routeProvider);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const greeting = useMemo(() => {
    const first = (userName.split(/[\s._-]/)[0] ?? userName).replace(/[^a-z0-9]/gi, "");
    if (first.length < 2) return "What would you like to run?";
    return `Hello, ${first.charAt(0).toUpperCase()}${first.slice(1)}`;
  }, [userName]);

  const loadThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setThreads(data.threads ?? []);
      if (data.migrationNeeded) setMigrationNeeded(true);
    } catch {
      /* history is best-effort */
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Arriving from the routing tab: put the caret where the sentence continues,
  // and drop `?route=` from the address bar. The chip is state now, so leaving
  // the parameter behind would only mean a reload silently re-adding a chip the
  // user had already dismissed.
  useEffect(() => {
    if (!routeProvider) return;
    inputRef.current?.focus();
    window.history.replaceState(null, "", window.location.pathname);
  }, [routeProvider]);

  // Below 900px the rail is an overlay (see styles/features/run.css), so leaving it open would
  // bury the conversation under it on every mobile load. It stays open by
  // default on desktop, where it is a real column.
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 900px)");
    if (narrow.matches) setHistoryOpen(false);
    const onChange = (event: MediaQueryListEvent) => setHistoryOpen(!event.matches);
    narrow.addEventListener("change", onChange);
    return () => narrow.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    // Only follow an actual conversation. On an empty thread this would scroll
    // straight past the Get started panel that sits above the welcome block.
    if (messages.length === 0) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  /** On mobile the rail covers the thread it just opened, so get it out of the way. */
  function closeRailOnMobile() {
    if (window.matchMedia("(max-width: 900px)").matches) setHistoryOpen(false);
  }

  async function openThread(id: string) {
    closeRailOnMobile();
    try {
      const res = await fetch(`/api/chat?thread=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setThreadId(id);
      setMessages(
        (data.messages ?? []).map((row: { id: number; role: "user" | "assistant"; content: string; thoughts: string | null }) => ({
          id: Number(row.id),
          key: `db-${row.id}`,
          role: row.role,
          content: row.content,
          thoughts: row.thoughts ?? "",
          status: "done" as const,
          startedAt: 0,
          thoughtMs: 0,
        })),
      );
    } catch {
      /* ignore */
    }
  }

  async function deleteThread(id: string) {
    const previous = threads;
    setThreads((rows) => rows.filter((row) => row.id !== id));
    if (threadId === id) {
      setThreadId(null);
      setMessages([]);
    }
    try {
      const res = await fetch(`/api/chat?thread=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) setThreads(previous);
    } catch {
      setThreads(previous);
    }
  }

  function startRename(thread: ThreadRow) {
    setRenaming(thread.id);
    setRenameDraft(thread.title);
  }

  /** Optimistic rename; the row snaps back if the write is rejected. */
  async function commitRename(id: string) {
    const title = renameDraft.trim().slice(0, 120);
    const previous = threads;
    setRenaming(null);
    if (!title || title === previous.find((row) => row.id === id)?.title) return;
    setThreads((rows) => rows.map((row) => (row.id === id ? { ...row, title } : row)));
    try {
      const res = await fetch(`/api/chat?thread=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) setThreads(previous);
    } catch {
      setThreads(previous);
    }
  }

  /** The composer grows itself via an inline style, so clearing the value is
   *  not enough — the box would stay at whatever height the last message had. */
  function resetComposerHeight() {
    if (inputRef.current) inputRef.current.style.height = "";
  }

  function newChat() {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setInput("");
    setChip(null);
    resetComposerHeight();
    closeRailOnMobile();
    inputRef.current?.focus();
  }

  /** Backspace at the very start of an empty selection is the gesture that would
   *  eat the character before the caret. There is no character there — there is
   *  the chip — so it takes the whole chip, all at once. */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const field = event.currentTarget;
    if (event.key === "Backspace" && chip && field.selectionStart === 0 && field.selectionEnd === 0) {
      event.preventDefault();
      setChip(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  }

  async function send(text: string) {
    // The chip is the head of the sentence the user is writing, so it is sent
    // as part of the message and consumed by the send — it is a draft, not a
    // sticky mode the next message would silently inherit.
    const rest = text.trim();
    const message = chip ? [chipText(chip), rest].filter(Boolean).join(": ") : rest;
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    setChip(null);
    resetComposerHeight();

    const userKey = `u-${Date.now()}`;
    const assistantKey = `a-${Date.now()}`;
    const startedAt = performance.now();
    setMessages((current) => [
      ...current,
      { key: userKey, role: "user", content: message, thoughts: "", status: "done", startedAt },
      { key: assistantKey, role: "assistant", content: "", thoughts: "", status: "streaming", startedAt },
    ]);

    const patch = (updates: Partial<ChatMsg> | ((msg: ChatMsg) => Partial<ChatMsg>)) =>
      setMessages((current) =>
        current.map((msg) =>
          msg.key === assistantKey ? { ...msg, ...(typeof updates === "function" ? updates(msg) : updates) } : msg,
        ),
      );

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, threadId: threadId ?? undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        // A server-side fault carries a request id; surfacing it distinguishes a
        // QRouter 500 from an upstream model-provider failure (which reads the
        // same) and points straight at the matching server log line.
        const requestId = data.error?.request_id ?? res.headers.get("x-request-id");
        const base = data.error?.message ?? `The assistant is unavailable (${res.status}).`;
        const cause = [data.error?.kind, data.error?.code].filter(Boolean).join(" ");
        const trailer = [cause, requestId && `request ${requestId}`].filter(Boolean).join(", ");
        throw new Error(trailer ? `${base} (${trailer})` : base);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          let data: { text?: string; threadId?: string; message?: string; assistantMessageId?: number | null };
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (eventName === "meta" && data.threadId && data.threadId !== "local") {
            setThreadId(data.threadId);
          } else if (eventName === "thought" && data.text) {
            patch((msg) => ({
              thoughts: msg.thoughts + data.text,
              thoughtMs: performance.now() - startedAt,
            }));
          } else if (eventName === "text" && data.text) {
            patch((msg) => ({
              content: msg.content + data.text,
              thoughtMs: msg.content ? msg.thoughtMs : msg.thoughtMs ?? performance.now() - startedAt,
            }));
          } else if (eventName === "done" && data.assistantMessageId) {
            patch({ id: Number(data.assistantMessageId) });
          } else if (eventName === "error") {
            throw new Error(data.message ?? "The assistant stream failed.");
          }
        }
      }
      patch({ status: "done" });
      loadThreads();
    } catch (error) {
      if (controller.signal.aborted) {
        patch((msg) => ({ status: "done", content: msg.content || "_Stopped._" }));
      } else {
        patch({
          status: "error",
          error: error instanceof Error ? error.message : "The assistant stream failed.",
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  const empty = messages.length === 0;

  return (
    <div className={`qc-shell ${historyOpen ? "" : "rail-collapsed"}`}>
      <div className="qc-body">
        {/* Only rendered under 900px, where the rail floats over the thread. */}
        <div className="qc-rail-scrim" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
        {/* thread rail — persistent, collapsible */}
        <aside className="qc-history" aria-label="Chat history">
          <div className="qc-history-head">
            <button type="button" className="qc-new-chat" onClick={newChat}>
              <Plus size={14} /> New chat
            </button>
          </div>
          <p className="qc-history-label">Recent</p>
          <div className="qc-history-list">
            {migrationNeeded && (
              <small className="qc-history-hint">
                Run <code>supabase/chat.sql</code> to enable saved history.
              </small>
            )}
            {threads.length === 0 && !migrationNeeded && (
              <small className="qc-history-hint">No saved chats yet.</small>
            )}
            {threads.map((thread) => (
              <div key={thread.id} className={`qc-history-row ${thread.id === threadId ? "active" : ""}`}>
                {renaming === thread.id ? (
                  <input
                    className="qc-rename-input"
                    value={renameDraft}
                    autoFocus
                    maxLength={120}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => commitRename(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitRename(thread.id);
                      }
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    aria-label="Chat title"
                  />
                ) : (
                  <>
                    <button type="button" className="qc-history-open" onClick={() => openThread(thread.id)} title={thread.title}>
                      {thread.title}
                    </button>
                    <span className="qc-history-actions">
                      <button type="button" aria-label="Rename chat" title="Rename" onClick={() => startRename(thread)}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" aria-label="Delete chat" title="Delete" onClick={() => deleteThread(thread.id)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* conversation */}
        <div className="qc-main">
          <div className="qc-mainbar">
            <button
              type="button"
              className="qc-rail-toggle"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-label={historyOpen ? "Hide chat history" : "Show chat history"}
              aria-expanded={historyOpen}
            >
              <PanelLeft size={15} />
            </button>
            <span className="qc-eyebrow">Assistant</span>
            <Link href="/dashboard/circuits" className="qc-mainbar-link">Run a stored circuit on several targets</Link>
          </div>

          <div className="qc-scroll" ref={scrollRef}>
            {showGetStarted && <GetStartedPanel />}
            {empty ? (
              <div className="qc-welcome">
                <h1>{greeting}</h1>
                <p>Describe a job, name a connected repository, or ask about hardware and pricing. Nothing runs until you approve a quote.</p>
                <ExamplePrompts items={SUGGESTIONS.slice(0, 3)} onPick={send} disabled={busy} />
              </div>
            ) : (
              <div className="qc-thread">
                {messages.map((msg) => {
                  if (msg.role === "user") {
                    return (
                      <div key={msg.key} className="qc-msg user">
                        <div className="qc-bubble">{msg.content}</div>
                      </div>
                    );
                  }
                  const { body, proposals } = splitChatProposals(msg.content);
                  return (
                    <div key={msg.key} className="qc-msg assistant">
                      <span className="qc-avatar"><LogoMark size={18} /></span>
                      <div className="qc-assistant-col">
                        <ThinkingBlock msg={msg} />
                        {msg.status === "streaming" && !msg.content && !msg.thoughts && (
                          <div className="qc-warming"><i /><i /><i /></div>
                        )}
                        {body && <Markdown text={body} />}
                        {msg.status === "streaming" && msg.content && <span className="qc-caret" aria-hidden="true" />}
                        {proposals.length > 0 && msg.status !== "streaming" && (
                          <div className="qc-proposal-list">
                            {proposals.length > 1 && <p>{proposals.length} job proposals matched from the connected repository.</p>}
                            {proposals.map((proposal, index) => (
                              <JobProposalCard
                                key={`${proposal.repository?.url ?? "inline"}:${proposal.repository?.path ?? proposal.name ?? "task"}:${index}`}
                                proposal={proposal}
                                balance={balance}
                                messageId={msg.id}
                                proposalIndex={index}
                              />
                            ))}
                          </div>
                        )}
                        {msg.status === "error" && (
                          <p className="qc-msg-error"><AlertCircle size={13} /> {msg.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* composer */}
          <form className={`qc-composer ${busy ? "busy" : ""}`} onSubmit={onSubmit}>
            {/* The chip and the textarea share one wrapping row, so the hint
                reads as the continuation of the chip's sentence rather than as
                a separate line under it. */}
            <div className="qc-composer-field">
              {chip && (
                <span className="qc-chip">
                  <span className="qc-chip-text">{chipText(chip)}</span>
                  <button
                    type="button"
                    className="qc-chip-clear"
                    onClick={() => {
                      setChip(null);
                      inputRef.current?.focus();
                    }}
                    aria-label={`Remove ${chip}`}
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              <textarea
                ref={inputRef}
                value={input}
                rows={2}
                placeholder={
                  chip
                    ? CHIP_PLACEHOLDER
                    : 'Describe a job, name a connected repo, or paste its URL… ("run bell-lab with 2048 shots")'
                }
                onChange={(event) => {
                  setInput(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
                }}
                onKeyDown={onComposerKeyDown}
                aria-label="Message the QRouter assistant"
              />
            </div>
            {busy ? (
              <button type="button" className="qc-send stop" onClick={() => abortRef.current?.abort()} aria-label="Stop generating">
                <CircleStop size={16} />
              </button>
            ) : (
              // With a chip in the composer there is already a sendable message
              // — "route using IonQ", and the assistant asks for the rest.
              <button type="submit" className="qc-send" disabled={!input.trim() && !chip} aria-label="Send">
                <ArrowUp size={16} />
              </button>
            )}
          </form>
          {/* The caveat that matters is that nothing is spent without a
              confirmation; the rest was already true of the card itself. */}
          <p className="qc-footnote">Nothing runs until you confirm the quote.</p>
        </div>
      </div>
    </div>
  );
}
