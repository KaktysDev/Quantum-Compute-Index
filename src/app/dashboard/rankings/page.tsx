import Link from "next/link";
import { ArrowRight, Award, Clock3, Gauge, Trophy } from "lucide-react";
import { getLatestSnapshot } from "@/lib/qci/store";
import { withQciSnapshot } from "@/lib/qrouter/catalog";

export default async function RankingsPage() {
  const latest = await getLatestSnapshot();
  const ranked = withQciSnapshot(latest.components).map((backend) => ({
    ...backend,
    score: backend.reliability * .35 + backend.fidelity * .35 + (1 / (1 + backend.queueSeconds / 300)) * .2 + (backend.available ? .1 : 0),
  })).sort((a, b) => b.score - a.score);
  return <div className="console-page rankings-page">
    <div className="console-page-heading compact"><div><p className="qr-eyebrow"><span /> Provider market</p><h1>Rankings</h1><p>Quantum targets ranked by fidelity, reliability, queue performance, and availability.</p></div><Link className="console-primary" href="/dashboard/providers">Browse providers <ArrowRight size={13} /></Link></div>
    <section className="ranking-method"><span><Trophy size={15} /> QRouter composite</span><div><b>35%</b> reliability</div><div><b>35%</b> fidelity</div><div><b>20%</b> queue</div><div><b>10%</b> availability</div></section>
    <section className="ranking-list"><div className="ranking-head"><span>Rank</span><span>Target</span><span>Score</span><span>Fidelity</span><span>Queue</span><span>Reliability</span><span>State</span></div>{ranked.map((backend, index) => <Link href={`/dashboard/providers/${backend.id}`} className="ranking-row" key={backend.id}><span className={`ranking-position rank-${index + 1}`}>{index < 3 ? <Award size={15} /> : null}{String(index + 1).padStart(2, "0")}</span><span><b>{backend.displayName}</b><small>{backend.provider} · {backend.kind}</small></span><span><b>{(backend.score * 100).toFixed(1)}</b><i><em style={{ width: `${backend.score * 100}%` }} /></i></span><span><Gauge size={12} />{(backend.fidelity * 100).toFixed(2)}%</span><span><Clock3 size={12} />{backend.queueSeconds}s</span><span>{(backend.reliability * 100).toFixed(1)}%</span><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Connected" : "BYOK"}</span></Link>)}</section>
  </div>;
}
