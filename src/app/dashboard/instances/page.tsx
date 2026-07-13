import InstancesManager from "@/components/InstancesManager";

export default function InstancesPage() {
  return <div className="console-page"><div className="console-page-heading compact"><div><p className="qr-eyebrow">Runtime infrastructure</p><h1>Instances</h1><p>Provision and manage isolated workers for transpilation and simulation.</p></div></div><InstancesManager /></div>;
}
