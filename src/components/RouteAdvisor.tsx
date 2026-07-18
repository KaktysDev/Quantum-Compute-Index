"use client";

import { useState } from "react";
import { AlertCircle, Bot, Check, Cpu, Loader2, Sparkles } from "lucide-react";
import type { RoutingMode } from "@/lib/qrouter/types";

const BELL = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

interface AdvisorTarget {
  id: string;
  displayName: string;
}

interface AdvisorResult {
  advice: string;
  model: string;
  analysis: {
    qubits: number;
    depth: number;
    gates: number;
    twoQubitGates: number;
    complexity: string;
  };
  decision: {
    selected: {
      id: string;
      displayName: string;
      provider: string;
      kind: string;
    };
    candidates: Array<{
      backend: { id: string; displayName: string; kind: string };
      compatible: boolean;
      score: number;
      estimatedProviderCost: number;
      rejectionReasons: string[];
    }>;
  };
  quote: {
    total: number;
  };
}

export default function RouteAdvisor({ targets }: { targets: AdvisorTarget[] }) {
  const [source, setSource] = useState(BELL);
  const [target, setTarget] = useState("auto");
  const [mode, setMode] = useState<RoutingMode>("balanced");
  const [shots, setShots] = useState(1024);
  const [question, setQuestion] = useState("Explain the selected route and what I should optimize next.");
  const [result, setResult] = useState<AdvisorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function advise() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/v1/ai/route-advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          circuit: source,
          format: /OPENQASM\s+3/i.test(source) ? "openqasm3" : "openqasm2",
          shots,
          target,
          routing_mode: mode,
          question,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Route advisor request failed.");
      setResult(data);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Route advisor request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="console-panel route-advisor-panel">
      <div className="panel-title"><Bot size={16} /><div><h2>Route advisor</h2><small>{result?.model ?? "AI guidance"}</small></div><span>LIVE</span></div>
      <div className="advisor-grid">
        <div className="advisor-inputs">
          <label><span>Circuit</span><textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} /></label>
          <div className="deployment-field-grid advisor-controls">
            <label><span>Shots</span><input type="number" min={1} max={1_000_000} value={shots} onChange={(event) => setShots(Number(event.target.value))} /></label>
            <label><span>Routing</span><select value={mode} onChange={(event) => setMode(event.target.value as RoutingMode)}><option value="balanced">balanced</option><option value="cost">cost</option><option value="speed">speed</option><option value="quality">quality</option></select></label>
            <label><span>Target</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="auto">auto</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
          </div>
          <label><span>Question</span><input value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
          {error && <div className="console-alert error"><AlertCircle size={15} />{error}</div>}
          <button className="console-primary" onClick={advise} disabled={busy || !source.trim()}>{busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />} Ask advisor</button>
        </div>
        <div className="advisor-output">
          {result ? <>
            <div className="advisor-selected"><span><Check size={14} /></span><div><small>Selected</small><b>{result.decision.selected.displayName}</b></div><strong>${result.quote.total.toFixed(4)}</strong></div>
            <dl>
              <div><dt>Circuit</dt><dd>{result.analysis.qubits}q · depth {result.analysis.depth} · {result.analysis.complexity}</dd></div>
              <div><dt>Provider</dt><dd>{result.decision.selected.provider} / {result.decision.selected.kind}</dd></div>
            </dl>
            <div className="advisor-text">{result.advice.split("\n").filter(Boolean).map((line) => <p key={line}>{line}</p>)}</div>
            <div className="advisor-candidates">
              {result.decision.candidates.slice(0, 3).map((candidate) => <div key={candidate.backend.id} className={candidate.compatible ? "" : "rejected"}><Cpu size={12} /><span>{candidate.backend.displayName}</span><b>{candidate.compatible ? `${Math.round(candidate.score * 100)}` : "skip"}</b></div>)}
            </div>
          </> : <div className="advisor-placeholder"><Bot size={22} /><p>Awaiting route analysis</p></div>}
        </div>
      </div>
    </section>
  );
}
