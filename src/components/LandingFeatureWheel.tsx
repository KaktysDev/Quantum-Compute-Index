"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { Braces, CircleDollarSign, Gauge, KeyRound, Route, Workflow } from "lucide-react";

const FEATURES = [
  { number: "#1", label: "ROUTE", title: "EVERY CORE", icon: Route, visual: "network", copy: "Candidates are filtered for circuit compatibility, then ranked using queue time, fidelity, live cost, and reliability." },
  { number: "#2", label: "TRANSPILE", title: "NATIVE CIRCUITS", icon: Braces, visual: "circuit", copy: "OpenQASM is parsed, mapped to the target topology, reduced to native gates, and verified before provider submission." },
  { number: "#3", label: "PRICE", title: "QCI ROUTING", icon: Gauge, visual: "index", copy: "The QCI rate snapshot moves with provider capacity and market prices, locking a quote before execution begins." },
  { number: "#4", label: "EXECUTE", title: "TASK LIFECYCLE", icon: Workflow, visual: "jobs", copy: "Every provider job is normalized into one observable lifecycle with cancellation, polling, webhooks, and results." },
  { number: "#5", label: "SECURE", title: "ONE API KEY", icon: KeyRound, visual: "key", copy: "Scoped QCI credentials authenticate the same request contract across every connected provider and simulator." },
  { number: "#6", label: "SETTLE", title: "UNIFIED BILLING", icon: CircleDollarSign, visual: "billing", copy: "Provider cost, transpilation, and platform fees settle against one reserved quote. Unused funds are released." },
] as const;

export default function LandingFeatureWheel({ price, changePct }: { price: number; changePct: number }) {
  const [active, setActive] = useState(0);
  const lastWheel = useRef(0);
  const move = useCallback((direction: number) => setActive((current) => (current + direction + FEATURES.length) % FEATURES.length), []);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const now = Date.now();
    if (Math.abs(event.deltaY) < 18 || now - lastWheel.current < 420) return;
    lastWheel.current = now;
    move(event.deltaY > 0 ? 1 : -1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") move(1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") move(-1);
  }

  const feature = FEATURES[active];

  return (
    <div className="qh-feature-wheel" onWheel={onWheel} onKeyDown={onKeyDown} tabIndex={0} aria-label="QRouter feature preview">
      <div className="qh-wheel-nav" role="tablist" aria-label="QRouter features">
        {FEATURES.map((item, index) => <button key={item.number} role="tab" aria-selected={index === active} className={index === active ? "active" : ""} onClick={() => setActive(index)}><span>{item.number}</span><b>{item.label}</b><i /></button>)}
      </div>

      <article className="qh-wheel-panel" key={feature.number} role="tabpanel">
        <div className="qh-wheel-copy">
          <p>{feature.number} {feature.label}</p><h2>{feature.title}</h2><p>{feature.copy}</p>
          <div className="qh-wheel-progress"><span>{String(active + 1).padStart(2, "0")}</span><i><b style={{ width: `${((active + 1) / FEATURES.length) * 100}%` }} /></i><span>{String(FEATURES.length).padStart(2, "0")}</span></div>
        </div>
        <div className={`qh-data-visual ${feature.visual}`}>
          {feature.visual === "network" && <div className="qh-route-data"><header><span>BACKEND</span><span>QUEUE</span><span>FIDELITY</span><span>COST</span><span>SCORE</span></header>{[["QCI Aer GPU","2s","100%","$0.003","0.96"],["IBM Brisbane","13m","99.2%","$0.66","0.73"],["IonQ Aria 1","20m","99.6%","$0.53","0.68"]].map((row,index)=><div key={row[0]} className={index===0?"winner":""}>{row.map((cell)=><span key={cell}>{cell}</span>)}</div>)}</div>}
          {feature.visual === "circuit" && <div className="qh-transpile-data"><div><span>BEFORE</span><strong>depth 12 / 14 gates</strong><div className="circuit-line"><b>q0</b><i>H</i><i>●</i><i>RZ</i><i>X</i><i>M</i></div><div className="circuit-line"><b>q1</b><i>H</i><i>⊕</i><i>X</i><i>RZ</i><i>M</i></div></div><em>−41%</em><div><span>IBM NATIVE</span><strong>depth 7 / 9 gates</strong><div className="circuit-line"><b>q0</b><i>SX</i><i>ECR</i><i>RZ</i><i>M</i></div><div className="circuit-line"><b>q1</b><i>RZ</i><i>ECR</i><i>SX</i><i>M</i></div></div></div>}
          {feature.visual === "index" && <div className="qh-market-data"><header><span>QCI / USD</span><strong>${price.toFixed(2)}</strong><em className={changePct>=0?"up":"down"}>{changePct>=0?"+":""}{changePct.toFixed(2)}%</em></header><div className="market-bars">{[34,42,38,54,48,65,58,74,69,81,76,88,84,93,87,96].map((height,index)=><i key={index} style={{height:`${height}%`}} />)}</div><footer><span>09:00</span><span>CAPACITY +18%</span><span>NOW</span></footer></div>}
          {feature.visual === "jobs" && <div className="qh-job-data">{[["01","ANALYZING","Circuit parsed"],["02","TRANSPILED","Native gates verified"],["03","ROUTED","QCI Aer GPU"],["04","COMPLETED","1,024 shots"]].map((row,index)=><div key={row[0]}><span>{row[0]}</span><i className={index===3?"done":""}/><b>{row[1]}</b><small>{row[2]}</small></div>)}</div>}
          {feature.visual === "key" && <div className="qh-key-data"><span>POST /api/v1/jobs</span><code>Authorization: Bearer qci_live_••••••••</code><code>{`{"routing_mode":"balanced","shots":1024}`}</code><div><i/><b>200 OK</b><small>job_92ac7f / queued</small></div></div>}
          {feature.visual === "billing" && <div className="qh-billing-data"><header><span>QUOTE / job_92ac7f</span><b>USD</b></header><dl><div><dt>Provider compute</dt><dd>$0.0024</dd></div><div><dt>Transpilation</dt><dd>$0.0004</dd></div><div><dt>Platform</dt><dd>$0.0003</dd></div><div><dt>Released reserve</dt><dd>−$0.0000</dd></div></dl><footer><span>SETTLED TOTAL</span><strong>$0.0031</strong></footer></div>}
        </div>
      </article>
    </div>
  );
}
