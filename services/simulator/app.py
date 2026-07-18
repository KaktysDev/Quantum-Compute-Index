from __future__ import annotations

import os
import base64
import io
import json
import secrets
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field
from qiskit import qasm2, qasm3, qpy, transpile
from qiskit_aer import AerSimulator
from qiskit.quantum_info import Operator
from qiskit.transpiler import CouplingMap, Target, generate_preset_pass_manager


TOKEN = os.environ.get("SIMULATOR_TOKEN", "")
MAX_QUBITS = int(os.environ.get("MAX_QUBITS", "30"))
MAX_SHOTS = int(os.environ.get("MAX_SHOTS", "1000000"))
EXECUTOR = ThreadPoolExecutor(max_workers=int(os.environ.get("WORKERS", "2")))
LOCK = threading.Lock()
JOB_DB_PATH = os.environ.get("JOB_DB_PATH", "/tmp/qrouter-simulator/jobs.sqlite3")


def database():
    os.makedirs(os.path.dirname(JOB_DB_PATH) or ".", exist_ok=True)
    connection = sqlite3.connect(JOB_DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with database() as connection:
        connection.execute("""
            create table if not exists jobs (
                id text primary key,
                idempotency_key text unique,
                status text not null,
                qasm text not null,
                shots integer not null,
                result text,
                error text,
                created_at real not null,
                updated_at real not null
            )
        """)


def deserialize_job(row):
    if row is None:
        return None
    job = {"id": row["id"], "status": row["status"], "createdAt": row["created_at"]}
    if row["result"]:
        job["result"] = json.loads(row["result"])
    if row["error"]:
        job["error"] = row["error"]
    return job


def get_stored_job(job_id: str):
    with database() as connection:
        return deserialize_job(connection.execute("select * from jobs where id=?", (job_id,)).fetchone())


def get_idempotent_job(idempotency_key: str):
    with database() as connection:
        return deserialize_job(connection.execute("select * from jobs where idempotency_key=?", (idempotency_key,)).fetchone())


def insert_stored_job(job_id: str, payload, idempotency_key: Optional[str] = None):
    now = time.time()
    with database() as connection:
        connection.execute(
            "insert into jobs(id,idempotency_key,status,qasm,shots,created_at,updated_at) values(?,?,?,?,?,?,?)",
            (job_id, idempotency_key, "submitted", payload.qasm, payload.shots, now, now),
        )
    return get_stored_job(job_id)


def update_stored_job(job_id: str, *, status: str, result=None, error=None, unless_cancelled=False):
    clause = " and status!='cancelled'" if unless_cancelled else ""
    with database() as connection:
        connection.execute(
            f"update jobs set status=?,result=?,error=?,updated_at=? where id=?{clause}",
            (status, json.dumps(result) if result is not None else None, error, time.time(), job_id),
        )


initialize_database()


class JobInput(BaseModel):
    qasm: str = Field(min_length=1, max_length=256_000)
    shots: int = Field(default=1024, ge=1, le=MAX_SHOTS)


class TranspileTarget(BaseModel):
    backend_id: str
    provider: str
    backend_name: Optional[str] = None
    num_qubits: int = Field(ge=1, le=10000)
    basis_gates: list[str] = Field(min_length=1)
    coupling_map: Optional[list[list[int]]] = None
    connectivity: Literal["target", "all-to-all", "custom"] = "target"


class TranspileInput(BaseModel):
    qasm: str = Field(min_length=1, max_length=256_000)
    target: TranspileTarget
    optimization_level: int = Field(default=2, ge=0, le=3)
    seed_transpiler: int = 42
    verify_equivalence: bool = True


class IbmJobInput(BaseModel):
    qpy: str = Field(min_length=1, max_length=2_000_000)
    shots: int = Field(default=1024, ge=1, le=MAX_SHOTS)


def authorize(authorization: Optional[str] = Header(default=None)):
    if not TOKEN or not authorization or not secrets.compare_digest(authorization, f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="Invalid simulator token")


def backend():
    if "GPU" in AerSimulator().available_devices():
        return AerSimulator(method="statevector", device="GPU"), "GPU"
    return AerSimulator(method="statevector"), "CPU"


def circuit_metrics(circuit):
    operations = {str(name): int(count) for name, count in circuit.count_ops().items()}
    return {
        "qubits": circuit.num_qubits,
        "classicalBits": circuit.num_clbits,
        "depth": circuit.depth() or 0,
        "gates": sum(count for name, count in operations.items() if name not in {"measure", "barrier", "delay"}),
        "twoQubitGates": sum(1 for instruction in circuit.data if len(instruction.qubits) == 2),
        "operations": operations,
    }


def serialize_layout(compiled):
    layout = getattr(compiled, "layout", None)
    if not layout:
        return None
    try:
        return {
            "logicalToPhysical": {
                str(virtual): int(physical)
                for virtual, physical in layout.initial_layout.get_virtual_bits().items()
            },
            "routingPermutation": list(layout.routing_permutation()),
        }
    except Exception:
        return {"description": str(layout)}


def verify_equivalence(original, compiled):
    try:
        source = original.remove_final_measurements(inplace=False)
        target = compiled.remove_final_measurements(inplace=False)
        if source.num_qubits != target.num_qubits:
            return None, "Layout introduced physical ancillas; provider target validation succeeded but direct unitary dimensions differ."
        equivalent = bool(Operator(source).equiv(Operator.from_circuit(target, ignore_set_layout=True)))
        return equivalent, None if equivalent else "Compiled circuit is not unitary-equivalent to the source circuit."
    except Exception as error:
        return None, f"Equivalence verification unavailable: {error}"


def ibm_backend(name: str):
    token = os.environ.get("IBM_QUANTUM_TOKEN")
    if not token:
        raise ValueError("IBM_QUANTUM_TOKEN is required for live IBM target retrieval")
    try:
        from qiskit_ibm_runtime import QiskitRuntimeService
    except ImportError as error:
        raise ValueError("qiskit-ibm-runtime is not installed in the compiler image") from error
    service = QiskitRuntimeService(
        channel="ibm_quantum_platform",
        token=token,
        instance=os.environ.get("IBM_QUANTUM_INSTANCE", "ibm-q/open/main"),
    )
    return service.backend(name)


def ibm_service():
    token = os.environ.get("IBM_QUANTUM_TOKEN")
    if not token:
        raise ValueError("IBM_QUANTUM_TOKEN is required")
    from qiskit_ibm_runtime import QiskitRuntimeService
    return QiskitRuntimeService(
        channel="ibm_quantum_platform",
        token=token,
        instance=os.environ.get("IBM_QUANTUM_INSTANCE", "ibm-q/open/main"),
    )


def compile_circuit(payload: TranspileInput):
    original = qasm2.loads(payload.qasm)
    if original.num_qubits > payload.target.num_qubits:
        raise ValueError(f"Circuit needs {original.num_qubits} qubits; {payload.target.backend_id} has {payload.target.num_qubits}")

    if payload.target.provider.lower() == "ibm" and payload.target.backend_name:
        pass_manager = generate_preset_pass_manager(
            backend=ibm_backend(payload.target.backend_name),
            optimization_level=payload.optimization_level,
            seed_transpiler=payload.seed_transpiler,
        )
    else:
        coupling = None
        if payload.target.connectivity == "custom" and payload.target.coupling_map:
            coupling = CouplingMap(payload.target.coupling_map)
        elif payload.target.connectivity == "target":
            raise ValueError(
                f"{payload.target.backend_id} requires a live provider target or coupling map; refusing all-to-all compilation"
            )
        target = Target.from_configuration(
            basis_gates=list(dict.fromkeys([*payload.target.basis_gates, "measure"])),
            num_qubits=payload.target.num_qubits,
            coupling_map=coupling,
        )
        pass_manager = generate_preset_pass_manager(
            target=target,
            optimization_level=payload.optimization_level,
            seed_transpiler=payload.seed_transpiler,
        )

    compiled = pass_manager.run(original)
    equivalent, verification_note = verify_equivalence(original, compiled) if payload.verify_equivalence else (None, "Verification disabled")
    if equivalent is False:
        raise ValueError(verification_note)
    before = circuit_metrics(original)
    after = circuit_metrics(compiled)
    qpy_buffer = io.BytesIO()
    qpy.dump(compiled, qpy_buffer)
    return {
        "qasm": qasm2.dumps(compiled),
        "artifactQasm": qasm3.dumps(compiled),
        "providerProgram": {"format": "qpy", "data": base64.b64encode(qpy_buffer.getvalue()).decode("ascii")},
        "target": payload.target.model_dump(),
        "optimizationLevel": payload.optimization_level,
        "seedTranspiler": payload.seed_transpiler,
        "before": before,
        "after": after,
        "layout": serialize_layout(compiled),
        "equivalent": equivalent,
        "verificationNote": verification_note,
        "improvement": {
            "depthPercent": round((before["depth"] - after["depth"]) / max(before["depth"], 1) * 100, 2),
            "gatePercent": round((before["gates"] - after["gates"]) / max(before["gates"], 1) * 100, 2),
        },
    }


def serialize_runtime_result(result):
    publications = []
    for publication in result:
        counts = {}
        data = getattr(publication, "data", None)
        if data is not None:
            for name in data.keys():
                value = getattr(data, name)
                if hasattr(value, "get_counts"):
                    for state, count in value.get_counts().items():
                        counts[state] = counts.get(state, 0) + int(count)
        publications.append({"counts": counts, "metadata": getattr(publication, "metadata", {})})
    return {"publications": publications, "counts": publications[0]["counts"] if publications else {}}


def execute(job_id: str, payload: JobInput):
    started = time.perf_counter()
    with LOCK:
        job = get_stored_job(job_id)
        if not job or job["status"] == "cancelled":
            return
        update_stored_job(job_id, status="processing")
    try:
        circuit = qasm2.loads(payload.qasm)
        if circuit.num_qubits > MAX_QUBITS:
            raise ValueError(f"Circuit needs {circuit.num_qubits} qubits; worker limit is {MAX_QUBITS}")
        simulator, device = backend()
        compiled = transpile(circuit, simulator, optimization_level=2)
        result = simulator.run(compiled, shots=payload.shots).result()
        counts = {str(state): int(count) for state, count in result.get_counts(compiled).items()}
        probabilities = {state: count / payload.shots for state, count in counts.items()}
        status = "completed"
        result_payload = {"counts": counts, "probabilities": probabilities,
                          "shots": payload.shots, "backend": "qci-aer-gpu", "executionMs": round((time.perf_counter() - started) * 1000, 2),
                          "metadata": {"engine": "Qiskit Aer", "device": device, "qubits": circuit.num_qubits, "depth": compiled.depth()}}
        error_message = None
    except Exception as error:
        status = "failed"
        result_payload = None
        error_message = str(error)
    with LOCK:
        update_stored_job(job_id, status=status, result=result_payload, error=error_message, unless_cancelled=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with database() as connection:
        rows = connection.execute("select id,qasm,shots from jobs where status in ('submitted','processing')").fetchall()
        connection.execute("update jobs set status='submitted',updated_at=? where status='processing'", (time.time(),))
    for row in rows:
        EXECUTOR.submit(execute, row["id"], JobInput(qasm=row["qasm"], shots=row["shots"]))
    yield


app = FastAPI(title="QRouter GPU Simulator", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    simulator, device = backend()
    return {"status": "ok", "device": device, "backend": simulator.name, "maxQubits": MAX_QUBITS}


@app.post("/v1/transpile", dependencies=[Depends(authorize)])
def transpile_circuit(payload: TranspileInput):
    try:
        return compile_circuit(payload)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/providers/ibm/jobs", dependencies=[Depends(authorize)], status_code=202)
def create_ibm_job(payload: IbmJobInput):
    try:
        from qiskit_ibm_runtime import SamplerV2
        circuits = qpy.load(io.BytesIO(base64.b64decode(payload.qpy, validate=True)))
        if len(circuits) != 1:
            raise ValueError("Exactly one compiled circuit is required")
        backend = ibm_backend(os.environ.get("IBM_QUANTUM_BACKEND", "ibm_brisbane"))
        job = SamplerV2(mode=backend).run(circuits, shots=payload.shots)
        return {"id": job.job_id(), "status": "submitted"}
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/providers/ibm/jobs/{job_id}", dependencies=[Depends(authorize)])
def get_ibm_job(job_id: str):
    try:
        job = ibm_service().job(job_id)
        status = str(job.status()).split(".")[-1].lower()
        if status in {"done", "completed"}:
            return {"status": "completed", "result": serialize_runtime_result(job.result())}
        if status in {"error", "failed"}:
            return {"status": "failed", "error": job.error_message() or "IBM Runtime job failed"}
        if status in {"cancelled", "canceled"}:
            return {"status": "cancelled"}
        return {"status": "processing" if status in {"running", "executing"} else "submitted"}
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.delete("/v1/providers/ibm/jobs/{job_id}", dependencies=[Depends(authorize)], status_code=204)
def cancel_ibm_job(job_id: str):
    try:
        ibm_service().job(job_id).cancel()
        return Response(status_code=204)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.post("/v1/jobs", dependencies=[Depends(authorize)], status_code=202)
def create_job(payload: JobInput, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    with LOCK:
        if idempotency_key:
            existing = get_idempotent_job(idempotency_key)
            if existing:
                return existing
        job_id = str(uuid.uuid4())
        job = insert_stored_job(job_id, payload, idempotency_key)
    EXECUTOR.submit(execute, job_id, payload)
    return job


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
def get_job(job_id: str):
    job = get_stored_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.delete("/v1/jobs/{job_id}", dependencies=[Depends(authorize)], status_code=204)
def cancel_job(job_id: str):
    with LOCK:
        job = get_stored_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job["status"] not in {"submitted", "queued"}:
            raise HTTPException(status_code=409, detail="Job has already started")
        update_stored_job(job_id, status="cancelled")
    return Response(status_code=204)
