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
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  CircleStop,
  History,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import QuantumParticles from "@/components/landing/QuantumParticles";
import LogoMark from "@/components/LogoMark";

// ── types ────────────────────────────────────────────────────────────────────

interface ThreadRow {
  id: string;
  title: string;
  updated_at: string;
}

interface ChatMsg {
  key: string;
  role: "user" | "assistant";
  content: string;
  thoughts: string;
  status: "streaming" | "done" | "error";
  error?: string;
  startedAt: number;
  thoughtMs?: number;
}

interface Proposal {
  name?: string;
  circuit?: string;
  repository?: { url: string; ref?: string; path: string };
  format?: "openqasm2" | "openqasm3";
  shots?: number;
  target?: string;
  routing_mode?: "balanced" | "cost" | "speed" | "quality";
  constraints?: { maxCost?: number; kind?: "qpu" | "simulator"; minFidelity?: number };
  note?: string;
}

const SUGGESTIONS = [
  "Compare IBM Brisbane and IonQ Aria for a 12-qubit variational circuit.",
  "What qubit count do I need for QAOA on a 20-node Max-Cut problem?",
  "What would 4,096 shots of a Bell state cost right now?",
  "Run a Bell state with 1,024 shots on the best available backend.",
];

/**
 * Rotating ghost suggestion: types one prompt out, holds ~2s, fades, then
 * moves to the next. Clicking sends the full suggestion. Reduced motion gets
 * a simple no-typing rotation.
 */
function GhostSuggestion({
  items,
  onPick,
  disabled,
}: {
  items: readonly string[];
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const [phase, setPhase] = useState<"typing" | "hold" | "fade">("typing");
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const text = items[index];
    if (reduced.current) {
      setChars(text.length);
      setPhase("hold");
      const next = window.setTimeout(() => {
        setChars(0);
        setIndex((i) => (i + 1) % items.length);
      }, 3600);
      return () => window.clearTimeout(next);
    }
    if (phase === "typing") {
      if (chars >= text.length) {
        setPhase("hold");
        return;
      }
      const t = window.setTimeout(() => setChars((c) => c + 1), 26);
      return () => window.clearTimeout(t);
    }
    if (phase === "hold") {
      const t = window.setTimeout(() => setPhase("fade"), 2_000);
      return () => window.clearTimeout(t);
    }
    // fade → advance after the CSS transition
    const t = window.setTimeout(() => {
      setChars(0);
      setPhase("typing");
      setIndex((i) => (i + 1) % items.length);
    }, 450);
    return () => window.clearTimeout(t);
  }, [phase, chars, index, items]);

  const text = items[index];
  return (
    <button
      type="button"
      className={`qc-ghost ${phase === "fade" ? "fade" : ""}`}
      onClick={() => onPick(text)}
      disabled={disabled}
      aria-label={`Try: ${text}`}
    >
      <span className="qc-ghost-try">try</span>
      <span className="qc-ghost-text">
        {text.slice(0, chars)}
        <i className="qc-ghost-caret" aria-hidden="true" />
      </span>
    </button>
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

function splitProposal(content: string): { body: string; proposal: Proposal | null } {
  const match = /```qrouter-proposal\s*\n([\s\S]*?)```/.exec(content);
  if (!match) return { body: content, proposal: null };
  let proposal: Proposal | null = null;
  try {
    proposal = JSON.parse(match[1]) as Proposal;
  } catch {
    proposal = null;
  }
  return { body: content.replace(match[0], "").trimEnd(), proposal };
}

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
}

function JobProposalCard({ proposal, balance }: { proposal: Proposal; balance: number | null }) {
  const [quote, setQuote] = useState<QuoteState>({ status: "loading" });
  const [phase, setPhase] = useState<"review" | "running" | "done" | "failed" | "dismissed">("review");
  const [result, setResult] = useState<{ id: string; status: string; backend: string; counts?: Record<string, number>; total?: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const shots = proposal.shots ?? 1024;

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

  async function run() {
    if (quote.status !== "ready" || !quote.circuit) return;
    setPhase("running");
    setRunError(null);
    try {
      const res = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
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
      if (!res.ok) throw new Error(data.error?.message ?? "Job submission failed.");
      setResult({
        id: data.id,
        status: data.status,
        backend: data.selected_backend_id,
        counts: data.result?.counts,
        total: data.quote?.total,
      });
      setPhase("done");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Job submission failed.");
      setPhase("failed");
    }
  }

  if (phase === "dismissed") {
    return <div className="qc-proposal dismissed"><X size={13} /> Proposal dismissed — nothing was run.</div>;
  }

  const insufficient =
    quote.status === "ready" && balance !== null && typeof quote.total === "number" && quote.total > balance;

  return (
    <div className="qc-proposal">
      <header>
        <Sparkles size={14} />
        <b>Job proposal</b>
        <span>requires your confirmation</span>
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
        <div><dt>Routing</dt><dd className="capitalize">{proposal.routing_mode ?? "balanced"} · {proposal.target ?? "auto"}</dd></div>
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

      {phase === "done" && result ? (
        <div className="qc-run-result">
          <p><Check size={14} /> Task <b>{result.status}</b> on <b>{result.backend}</b>{typeof result.total === "number" && <> · settled <b>${result.total.toFixed(4)}</b></>}</p>
          {result.counts && (
            <div className="qc-counts">
              {Object.entries(result.counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([state, count]) => (
                  <div key={state}>
                    <code>|{state}⟩</code>
                    <i style={{ width: `${Math.max(4, (count / shots) * 100)}%` }} />
                    <b>{count}</b>
                  </div>
                ))}
            </div>
          )}
          <Link href={`/dashboard/tasks?job=${result.id}`}>View task details →</Link>
        </div>
      ) : (
        <footer>
          <button
            type="button"
            className="qc-run"
            onClick={run}
            disabled={quote.status !== "ready" || phase === "running" || insufficient}
          >
            {phase === "running" ? <><Loader2 size={14} className="spin" /> Routing &amp; executing…</> : <>Confirm &amp; run</>}
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
}: {
  userName: string;
  balance: number | null;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const welcome = useMemo(() => {
    const first = userName.split(/[\s._-]/)[0] ?? userName;
    const safe = first.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
    return safe.length >= 2 ? `HELLO, ${safe}` : "QROUTER AI";
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function openThread(id: string) {
    setHistoryOpen(false);
    try {
      const res = await fetch(`/api/chat?thread=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setThreadId(id);
      setMessages(
        (data.messages ?? []).map((row: { id: number; role: "user" | "assistant"; content: string; thoughts: string | null }) => ({
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
    setThreads((rows) => rows.filter((row) => row.id !== id));
    if (threadId === id) {
      setThreadId(null);
      setMessages([]);
    }
    try {
      await fetch(`/api/chat?thread=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setHistoryOpen(false);
    setInput("");
    inputRef.current?.focus();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");

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
        throw new Error(data.error?.message ?? `The assistant is unavailable (${res.status}).`);
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
          let data: { text?: string; threadId?: string; message?: string };
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
    <div className="qc-shell">
      {/* header row */}
      <div className="qc-topline">
        <div>
          <p className="qc-eyebrow"><Sparkles size={12} /> QRouter Assistant</p>
          <span>Ask about hardware, pricing, repos — or hand it a job to prepare.</span>
        </div>
        <div className="qc-topline-actions">
          <span className="qc-balance"><Wallet size={12} /> ${balance === null ? "—" : balance.toFixed(2)}</span>
          <button type="button" onClick={() => setHistoryOpen((v) => !v)} className={historyOpen ? "active" : ""}>
            <History size={14} /> History
          </button>
          <button type="button" onClick={newChat}>
            <Plus size={14} /> New chat
          </button>
        </div>
      </div>

      <div className="qc-body">
        {/* history rail */}
        {historyOpen && (
          <aside className="qc-history">
            <p>Recent chats</p>
            {migrationNeeded && (
              <small className="qc-history-hint">
                Run <code>supabase/chat.sql</code> to enable saved history.
              </small>
            )}
            {threads.length === 0 && !migrationNeeded && <small className="qc-history-hint">No saved chats yet.</small>}
            {threads.map((thread) => (
              <div key={thread.id} className={`qc-history-row ${thread.id === threadId ? "active" : ""}`}>
                <button type="button" onClick={() => openThread(thread.id)} title={thread.title}>
                  {thread.title}
                </button>
                <button type="button" aria-label="Delete chat" onClick={() => deleteThread(thread.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </aside>
        )}

        {/* conversation */}
        <div className="qc-main">
          <div className="qc-scroll" ref={scrollRef}>
            {empty ? (
              <div className="qc-welcome">
                <div className="qc-welcome-particles">
                  <QuantumParticles label={welcome} className="qc-particle-canvas" />
                </div>
                <h1>What quantum job would you like to run?</h1>
                <p>
                  Compare providers, size a workload, inspect a GitHub repo, or ask me to prepare a run —
                  you approve every job before it executes.
                </p>
                <GhostSuggestion items={SUGGESTIONS} onPick={send} disabled={busy} />
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
                  const { body, proposal } = splitProposal(msg.content);
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
                        {proposal && msg.status !== "streaming" && (
                          <JobProposalCard proposal={proposal} balance={balance} />
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
            <textarea
              ref={inputRef}
              value={input}
              rows={2}
              placeholder='Describe a job, paste a GitHub repo URL, or ask anything quantum… ("run bell.qasm with 2048 shots")'
              onChange={(event) => {
                setInput(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              aria-label="Message the QRouter assistant"
            />
            {busy ? (
              <button type="button" className="qc-send stop" onClick={() => abortRef.current?.abort()} aria-label="Stop generating">
                <CircleStop size={16} />
              </button>
            ) : (
              <button type="submit" className="qc-send" disabled={!input.trim()} aria-label="Send">
                <ArrowUp size={16} />
              </button>
            )}
          </form>
          <p className="qc-footnote">
            Jobs run only after you confirm the quote. The assistant can be wrong — the confirmation card
            always shows QRouter&apos;s own numbers.
          </p>
        </div>
      </div>
    </div>
  );
}
