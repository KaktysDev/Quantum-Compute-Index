import { CircuitsList } from "@/components/circuits/CircuitsList";
import { UploadCircuitButton } from "@/components/circuits/UploadCircuitDialog";
import { PageHeader } from "@/components/console/ui";

export const metadata = { title: "QRouter Console — Circuits" };

export default function CircuitsPage() {
  return (
    <div className="console-page wide">
      <PageHeader
        title="Circuits"
        description="Stored OpenQASM circuits. Run one on several targets at once, then release its source when you are done."
        actions={<UploadCircuitButton />}
      />
      <CircuitsList />
    </div>
  );
}
