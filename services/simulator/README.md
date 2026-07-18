# QRouter GPU simulator

Build and publish the image, then run it on a Vultr Cloud GPU with the NVIDIA
container runtime:

```bash
docker build -t registry.example.com/qrouter-simulator:latest .
docker run --gpus all -p 8080:8080 \
  -e SIMULATOR_TOKEN="$VULTR_SIMULATOR_TOKEN" \
  -e JOB_DB_PATH=/var/lib/qrouter/jobs.sqlite3 \
  -v qrouter-jobs:/var/lib/qrouter \
  registry.example.com/qrouter-simulator:latest
```

Point `VULTR_SIMULATOR_URL` at the TLS-terminated worker URL. The public health
endpoint reports whether Aer selected GPU or CPU; all job endpoints require the
shared bearer token. Simulator jobs and idempotency keys are persisted in SQLite,
and interrupted jobs resume when the worker restarts. Use a persistent volume for
`JOB_DB_PATH`.

The same image exposes `POST /v1/transpile`. QRouter sends a provider target,
basis gates, connectivity, optimization level, and deterministic seed. For IBM,
the worker retrieves the live `BackendV2` target using `IBM_QUANTUM_TOKEN`, so
layout, routing, native-gate translation, and calibration-aware optimization use
the provider's current target instead of a static approximation.

For IBM, the image also exposes authenticated create/status/cancel endpoints
under `/v1/providers/ibm/jobs`. The web tier sends the exact transpiled circuit
as QPY and the worker submits it through Qiskit Runtime `SamplerV2`; IBM tokens
never pass through the public API response.

SQLite is appropriate for one worker instance. A multi-instance deployment still
needs a shared queue/database, or sticky routing to workers with separately
addressable job stores. Provider jobs remain durable at IBM, IonQ, or Braket.
