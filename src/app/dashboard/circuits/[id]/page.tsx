import { CircuitDetail } from "@/components/circuits/CircuitDetail";

export const metadata = { title: "QRouter Console — Circuit" };

export default async function CircuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CircuitDetail id={id} />;
}
