"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Server, Square, Trash2 } from "lucide-react";

type Instance = { id: string; name: string; runtime: string; region: string; size: string; status: "provisioning" | "running" | "stopped"; createdAt: string };
const STORAGE_KEY = "qrouter.instances.v1";

export default function InstancesManager() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("qrouter-worker");
  const [runtime, setRuntime] = useState("Qiskit 1.2");
  const [region, setRegion] = useState("us-central");
  const [size, setSize] = useState("2 vCPU / 8 GB");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setInstances(JSON.parse(saved) as Instance[]);
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(instances)); }, [instances, loaded]);

  function createInstance() {
    if (!name.trim()) return;
    const id = `ins_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    setInstances((current) => [{ id, name: name.trim(), runtime, region, size, status: "provisioning", createdAt: new Date().toISOString() }, ...current]);
    window.setTimeout(() => setInstances((current) => current.map((item) => item.id === id ? { ...item, status: "running" } : item)), 1800);
  }

  function toggle(id: string) {
    setInstances((current) => current.map((item) => item.id === id ? { ...item, status: item.status === "running" ? "stopped" : "running" } : item));
  }

  return (
    <div className="instance-layout">
      <section className="console-panel instance-create">
        <div className="panel-title"><Plus size={16} /><div><h2>Create execution instance</h2><small>Managed circuit worker</small></div></div>
        <div className="instance-form">
          <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Runtime</span><select value={runtime} onChange={(event) => setRuntime(event.target.value)}><option>Qiskit 1.2</option><option>OpenQASM 3</option><option>PennyLane 0.40</option></select></label>
          <label><span>Region</span><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="us-central">US Central</option><option value="us-east">US East</option><option value="eu-north">EU North</option></select></label>
          <label><span>Worker size</span><select value={size} onChange={(event) => setSize(event.target.value)}><option>2 vCPU / 8 GB</option><option>4 vCPU / 16 GB</option><option>8 vCPU / 32 GB</option></select></label>
          <button className="console-primary" onClick={createInstance}><Server size={14} /> Create instance</button>
        </div>
      </section>

      <section className="console-panel instance-list">
        <div className="panel-title"><Server size={16} /><div><h2>Execution instances</h2><small>{instances.length} configured</small></div></div>
        <div className="instance-head"><span>Instance</span><span>Runtime</span><span>Region</span><span>Size</span><span>Status</span><span /></div>
        {!loaded ? <div className="console-empty"><Loader2 className="spin" /></div> : instances.length === 0 ? <div className="console-empty"><Server /><p>No execution instances</p></div> : instances.map((instance) => (
          <div className="instance-row" key={instance.id}>
            <span><b>{instance.name}</b><small>{instance.id}</small></span><span>{instance.runtime}</span><span>{instance.region}</span><span>{instance.size}</span>
            <span className={`instance-status ${instance.status}`}>{instance.status === "provisioning" ? <Loader2 className="spin" size={12} /> : instance.status === "running" ? <CheckCircle2 size={12} /> : <Square size={11} />}{instance.status}</span>
            <span className="instance-actions"><button onClick={() => toggle(instance.id)} title={instance.status === "running" ? "Stop" : "Start"}><Square size={13} /></button><button onClick={() => setInstances((current) => current.filter((item) => item.id !== instance.id))} title="Delete"><Trash2 size={13} /></button></span>
          </div>
        ))}
      </section>
    </div>
  );
}
