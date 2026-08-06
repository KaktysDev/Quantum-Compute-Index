import DocsCodeTabs from "@/components/docs/DocsCodeTabs";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";

const BASE = PUBLIC_CONFIG.apiBaseUrl;

const EXAMPLES = {
  curl: `# 1 · Store the circuit once. The response carries the reusable circuit id.
curl ${BASE}/api/v2/circuits \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: bell-circuit-001" \\
  -d '{
    "name": "bell",
    "format": "openqasm2",
    "circuit": "OPENQASM 2.0; include \\"qelib1.inc\\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;"
  }'
# 201 { "object": "circuit", "data": { "id": "...", "source_hash": "...", "analysis": { ... } } }

# 2 · Fan that circuit out across up to 25 executions in one job.
#     Replace circuit_id with data.id from step 1.
curl ${BASE}/api/v2/jobs \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: bell-compare-001" \\
  -d '{
    "circuit_id": "00000000-0000-0000-0000-000000000000",
    "metadata": { "experiment": "bell-baseline" },
    "executions": [
      { "key": "recommended", "target": "auto", "shots": 1024 },
      { "key": "sv1", "target": "aws-sv1", "shots": 1024, "routing_mode": "cost" }
    ]
  }'
# 202 { "object": "job", "data": { "id": "...", "status": "running", "executions": [ ... ] } }

# 3 · Poll the job until it is terminal, then read each execution artifact.
curl ${BASE}/api/v2/jobs/$JOB_ID \\
  -H "Authorization: Bearer $QROUTER_API_KEY"

curl ${BASE}/api/v2/executions/$EXECUTION_ID/result \\
  -H "Authorization: Bearer $QROUTER_API_KEY"`,
  typescript: `import { QRouterV2 } from "@qrouter/sdk";

const qrouter = new QRouterV2(process.env.QROUTER_API_KEY!);

const circuit = await qrouter.circuits.create({
  circuit: await readFile("bell.qasm", "utf8"),
  name: "bell",
}, "bell-circuit-001");

const job = await qrouter.jobs.create({
  circuit_id: circuit.id,
  metadata: { experiment: "bell-baseline" },
  executions: [
    { key: "recommended", target: "auto", shots: 1024 },
    { key: "sv1", target: "aws-sv1", shots: 1024, routing_mode: "cost" },
  ],
}, "bell-compare-001");

const completed = await qrouter.jobs.wait(job.id, 2_000, (update) => console.log(update.status));

for (const execution of completed.executions) {
  if (!execution.result_available) continue;
  console.log(execution.key, execution.selected_backend_id, await qrouter.executions.result(execution.id));
}`,
  python: `from qrouter import QRouterV2
import os

with QRouterV2(os.environ["QROUTER_API_KEY"]) as qrouter:
    with open("bell.qasm") as source:
        circuit = qrouter.create_circuit(source.read(), name="bell", idempotency_key="bell-circuit-001")

    job = qrouter.create_hosted_job(
        circuit["id"],
        [
            {"key": "recommended", "target": "auto", "shots": 1024},
            {"key": "sv1", "target": "aws-sv1", "shots": 1024, "routing_mode": "cost"},
        ],
        metadata={"experiment": "bell-baseline"},
        idempotency_key="bell-compare-001",
    )

    completed = qrouter.wait_hosted_job(job["id"])
    for execution in completed["executions"]:
        if not execution["result_available"]:
            continue
        result = qrouter.get_execution_result(execution["id"])
        print(execution["key"], execution["selected_backend_id"], result["counts"])`,
};

export default function DocsV2CodeExamples() {
  return <DocsCodeTabs examples={EXAMPLES} label="API v2 quickstart language" />;
}
