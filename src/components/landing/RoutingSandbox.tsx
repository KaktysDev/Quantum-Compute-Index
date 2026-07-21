"use client";

import { useMemo, useState } from "react";
import { Check, Gauge, Timer, WalletCards, Waves } from "lucide-react";

type Mode = "balanced" | "cost" | "speed" | "quality";
type Candidate = { id: string; name: string; queue: number; fidelity: number; cost: number };

const MODES: Array<{ id: Mode; label: string; icon: typeof Gauge }> = [
  { id: "balanced", label: "Balanced", icon: Gauge },
  { id: "cost", label: "Cost", icon: WalletCards },
  { id: "speed", label: "Speed", icon: Timer },
  { id: "quality", label: "Quality", icon: Waves },
];

const SELECTED: Record<Mode, string> = {
  balanced: "ibm-brisbane",
  cost: "ionq-aria-1",
  speed: "iqm-garnet",
  quality: "ionq-aria-1",
};

export default function RoutingSandbox({ candidates }: { candidates: Candidate[] }) {
  const [mode, setMode] = useState<Mode>("balanced");
  const selectedId = SELECTED[mode];
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const range = useMemo(() => {
    const costs = candidates.map((candidate) => Math.log10(candidate.cost));
    return { min: Math.min(...costs), max: Math.max(...costs) };
  }, [candidates]);

  return (
    <div className="ql-plot ql-routing-demo">
      <div className="ql-plot-tabs" role="tablist" aria-label="Routing policy">
        {MODES.map((item) => (
          <button type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "active" : ""} key={item.id} onClick={() => setMode(item.id)}>
            <item.icon /> {item.label}
          </button>
        ))}
      </div>
      <div className="ql-routing-summary">
        <span><Check /> SELECTED</span>
        <strong>{selected?.name}</strong>
        <small>{mode.toUpperCase()} POLICY · PHYSICAL QPU REQUIRED</small>
      </div>
      <div className="ql-plot-area ql-catalog-plot">
        <span className="ql-axis-y">TWO-QUBIT FIDELITY</span>
        <span className="ql-axis-x">ESTIMATED 1,024-SHOT COST (LOG) →</span>
        {candidates.map((candidate) => {
          const left = 12 + ((Math.log10(candidate.cost) - range.min) / Math.max(.001, range.max - range.min)) * 70;
          const top = 20 + (1 - candidate.fidelity) * 2600;
          return (
            <i className={`ql-dot ${candidate.id === selectedId ? "selected" : ""}`} style={{ left: `${left}%`, top: `${Math.min(72, top)}%` }} key={candidate.id}>
              <b>{candidate.name}</b><small>{candidate.queue}s queue · ${candidate.cost.toFixed(3)}</small>
            </i>
          );
        })}
      </div>
      <footer><span>ILLUSTRATIVE QCI RATE SNAPSHOT</span><span>3 ELIGIBLE / 5 CHECKED</span></footer>
    </div>
  );
}
