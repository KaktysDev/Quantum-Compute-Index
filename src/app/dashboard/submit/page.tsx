import SubmitTask from "@/components/SubmitTask";
import { BACKENDS } from "@/lib/qrouter/catalog";

export default function SubmitTaskPage() {
  return <div className="console-page"><div className="console-page-heading compact"><div><p className="qr-eyebrow">Universal execution</p><h1>Submit a task</h1><p>Upload a circuit, define the constraints, and let QCI handle the rest.</p></div></div><SubmitTask backends={BACKENDS} /></div>;
}
