"use client";

import { useMemo, useState } from "react";
import { EncodingPreview, EncodingStageStrip, overlayExecute } from "@/components/encoding/EncodingProcess";
import { encodingTargets, MODALITY_LABEL } from "@/lib/qrouter/encoding/preview";

/** Live catalog preview so researchers can change platform parameters before a job exists. */
export function EncodingSandbox() {
  const targets = useMemo(() => encodingTargets(), []);
  const [targetId, setTargetId] = useState("auto");
  const [shots, setShots] = useState(1024);
  const [qubits, setQubits] = useState(2);
  const [routingMode, setRoutingMode] = useState("balanced");
  const [format, setFormat] = useState<"openqasm2" | "openqasm3">("openqasm2");
  const [kind, setKind] = useState<"" | "qpu" | "simulator">("");
  const selected = targets.find((item) => item.id === targetId);
  const encodingValue = selected ? `${selected.encodingLabel} · ${MODALITY_LABEL[selected.modality]}` : "Chosen after routing";

  return (
    <section className="enc-sandbox" aria-label="Encoding layer preview">
      <header>
        <p className="enc-preview-kicker">Encoding layer</p>
        <h2>What will happen when this is encoded</h2>
        <p>Change the platform parameters. The plan updates immediately — nothing is submitted.</p>
      </header>
      <div className="enc-sandbox-controls">
        <label>
          <span>Backend</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-label="Preview backend">
            <option value="auto">Automatic — encoder pending route</option>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName} · {item.encodingLabel}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Encoding / modality</span>
          <input
            readOnly
            value={targetId === "auto" ? "Chosen after routing" : encodingValue}
            title={targetId === "auto" ? "The encoder is chosen after routing" : encodingValue}
            aria-label="Selected encoding and modality"
          />
        </label>
        <label>
          <span>Qubits</span>
          <input type="number" min={1} max={216} value={qubits} onChange={(event) => setQubits(Math.max(1, Number(event.target.value) || 1))} aria-label="Preview qubit count" />
        </label>
        <label>
          <span>Shots</span>
          <input type="number" min={1} max={1_000_000} value={shots} onChange={(event) => setShots(Math.max(1, Number(event.target.value) || 1))} aria-label="Preview shots" />
        </label>
        <label>
          <span>Input</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} aria-label="Preview input format">
            <option value="openqasm2">OpenQASM 2</option>
            <option value="openqasm3">OpenQASM 3</option>
          </select>
        </label>
        <label>
          <span>Routing</span>
          <select value={routingMode} onChange={(event) => setRoutingMode(event.target.value)} aria-label="Preview routing mode">
            <option value="balanced">balanced</option>
            <option value="cost">cost</option>
            <option value="speed">speed</option>
            <option value="quality">quality</option>
          </select>
        </label>
        <label>
          <span>Compute type</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Preview compute type">
            <option value="">Any</option>
            <option value="simulator">Simulator</option>
            <option value="qpu">Physical QPU</option>
          </select>
        </label>
      </div>
      <EncodingPreview
        defaultOpen
        targetId={targetId}
        shots={shots}
        qubits={qubits}
        format={format}
        routingMode={routingMode}
        kind={kind || undefined}
        phase={targetId === "auto" ? "quoting" : "ready"}
      />
      <EncodingStageStrip stages={overlayExecute(undefined)} compact />
    </section>
  );
}
