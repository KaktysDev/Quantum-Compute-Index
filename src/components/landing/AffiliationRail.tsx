import Image from "next/image";

type Affiliation = { name: string; src: string; width: number; height: number; compact?: boolean; suffix?: string };

const AFFILIATIONS: Affiliation[] = [
  { name: "Qunnect", src: "/affiliations/qunnect.png", width: 44, height: 44, compact: true },
  { name: "Meta", src: "/affiliations/meta.svg", width: 132, height: 42 },
  { name: "MIT", src: "/affiliations/mit.svg", width: 82, height: 44 },
  { name: "Stanford University", src: "/affiliations/stanford.svg", width: 168, height: 44 },
  { name: "Forbes 30 Under 30", src: "/affiliations/forbes.svg", width: 112, height: 34, suffix: "30 UNDER 30" },
  { name: "Princeton University", src: "/affiliations/princeton.svg", width: 164, height: 44 },
  { name: "IBM", src: "/affiliations/ibm.svg", width: 92, height: 38 },
];

function Logos({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="ql-affiliation-group" aria-hidden={hidden || undefined}>
      {AFFILIATIONS.map((affiliation) => (
        <div className="ql-affiliation-logo" key={`${hidden ? "copy-" : ""}${affiliation.name}`}>
          <Image src={affiliation.src} alt={hidden ? "" : affiliation.name} width={affiliation.width} height={affiliation.height} />
          {affiliation.compact && <strong>QUNNECT</strong>}
          {affiliation.suffix && <strong>{affiliation.suffix}</strong>}
        </div>
      ))}
    </div>
  );
}

export default function AffiliationRail() {
  return (
    <section className="ql-affiliations" aria-labelledby="affiliations-title">
      <div className="ql-shell ql-affiliation-head">
        <p className="ql-kicker">NETWORK</p>
        <h2 id="affiliations-title">Backed by advisors and angels from</h2>
      </div>
      <div className="ql-affiliation-reel">
        <div className="ql-affiliation-track"><Logos /><Logos hidden /></div>
      </div>
      <p className="ql-shell ql-affiliation-note">Past and present affiliations of individual advisors and supporters. Organizations shown do not imply institutional endorsement.</p>
    </section>
  );
}
