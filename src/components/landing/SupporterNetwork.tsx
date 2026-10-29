import Image from "next/image";

const AFFILIATIONS = [
  { name: "Stanford University", src: "stanford.svg", width: 180, height: 45 },
  { name: "Forbes 30 Under 30", src: "forbes.svg", width: 130, height: 36, suffix: "30 UNDER 30" },
  { name: "Princeton University", src: "princeton.svg", width: 175, height: 51 },
  { name: "IBM", src: "ibm.svg", width: 110, height: 45 },
  { name: "MIT", src: "mit.svg", width: 96, height: 50 },
  { name: "Qunnect", src: "qunnect.png", width: 48, height: 48, suffix: "Qunnect" },
  { name: "Meta", src: "meta.svg", width: 145, height: 46 },
];

export default function SupporterNetwork() {
  return <section className="qt-supporters qt-shell" id="supporters" aria-labelledby="supporters-title">
    <div className="qt-supporters-heading"><p className="qt-eyebrow">Our network</p><h2 id="supporters-title" className="qt-display">Investors &<br />supporters.</h2><span className="qt-supporters-symbol" aria-hidden="true">↗</span></div>
    <div className="qt-supporter-logos" aria-label="Individual supporter affiliations">
      {AFFILIATIONS.map(affiliation => <div className={"qt-supporter-logo" + (affiliation.src === "qunnect.png" ? " qt-supporter-qunnect" : "")} key={affiliation.name}>
        <Image src={"/affiliations/" + affiliation.src} alt={affiliation.name} width={affiliation.width} height={affiliation.height} />
        {affiliation.suffix && <span aria-hidden="true">{affiliation.suffix}</span>}
      </div>)}
    </div>
    <p className="qt-supporters-note">Affiliations of individual investors and supporters. Logos do not imply institutional investment or endorsement.</p>
  </section>;
}
