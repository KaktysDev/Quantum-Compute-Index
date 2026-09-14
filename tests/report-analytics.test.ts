import { describe, expect, it } from "vitest";
import { computeAnalytics } from "@/lib/qrouter/report/analytics";
import { buildReportContext } from "@/lib/qrouter/report/context";
import { deterministicNarrative } from "@/lib/qrouter/report/narrative";

describe("result analytics from real counts", () => {
  it("computes entropy and ranking from a stored histogram only", () => {
    const analytics = computeAnalytics({
      counts: { "00": 512, "11": 512 },
      probabilities: { "00": 0.5, "11": 0.5 },
      shots: 1024,
      requestedShots: 1024,
      metadata: { normalized: true, bit_order: "q0_right" },
    });
    expect(analytics.available).toBe(true);
    expect(analytics.distinctStates).toBe(2);
    expect(analytics.shotsMatch).toBe(true);
    expect(analytics.shannonEntropyBits).toBeCloseTo(1, 8);
    expect(analytics.mostProbable).toBe("00");
    expect(analytics.fidelity).toBeNull();
    expect(analytics.expected).toBeNull();
    expect(analytics.top[0]?.count).toBe(512);
  });

  it("does not invent fidelity, expected distributions, or shot entropy from synthetic counts", () => {
    const analytics = computeAnalytics({
      probabilities: { "0": 0.7, "1": 0.3 },
      requestedShots: 100,
      metadata: {
        synthetic: [{ field: "counts", reason: "derived_from_probabilities", method: "largest_remainder" }],
      },
    });
    expect(analytics.available).toBe(true);
    expect(analytics.countsAreSynthetic).toBe(true);
    expect(analytics.shannonEntropyBits).toBeNull();
    expect(analytics.probabilityEntropyBits).not.toBeNull();
    expect(analytics.fidelity).toBeNull();
    expect(analytics.stderr).toBeNull();
    expect(analytics.expected).toBeNull();
    expect(analytics.notes.some((note) => /derived from probabilities/i.test(note))).toBe(true);
  });

  it("stays empty when the job has no results", () => {
    const analytics = computeAnalytics({ requestedShots: 256 });
    expect(analytics.available).toBe(false);
    expect(analytics.histogram).toEqual([]);
    expect(analytics.reason).toMatch(/no measurement results/i);
  });

  it("surfaces expected rows only when they were stored", () => {
    const analytics = computeAnalytics({
      counts: { "00": 90, "11": 10 },
      shots: 100,
      requestedShots: 100,
      metadata: { expected: { "00": 100 } },
    });
    expect(analytics.expected).toEqual([{ bitstring: "00", count: 100, probability: 1 }]);
  });
});

describe("report context grounding", () => {
  it("never copies QASM, payloads, or providerResult into the public report", () => {
    const context = buildReportContext({
      job: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Bell",
        status: "completed",
        selected_backend_id: "qci-aer-gpu",
        shots: 1024,
        source: "OPENQASM 2.0;\nqreg q[2];",
        created_at: "2026-09-14T00:00:00.000Z",
        completed_at: "2026-09-14T00:00:01.000Z",
        analysis: {
          qubits: 2,
          depth: 3,
          normalizedQasm2: "OPENQASM 2.0; qreg q[2];",
          encoding: { selected_bundle: { payload: "OPENQASM 2.0; secret", decode_map: { measurement_map: [{ qubit: 0, clbit: 0 }] } } },
        },
        quote: { total: 0.0123 },
      },
      result: {
        counts: { "00": 512, "11": 512 },
        shots: 1024,
        backend: "qci-aer-gpu",
        metadata: { normalized: true, providerResult: { raw: "OPENQASM 2.0;", token: "Bearer sk-secret" } },
      },
    });
    const blob = JSON.stringify(context);
    expect(blob).not.toMatch(/OPENQASM|qreg|providerResult|Bearer |payload/i);
    expect(context.job.backendName).toBe("QCI Aer CPU");
    expect(context.job.cost).toBeCloseTo(0.0123);
    expect(context.analytics.measurementMap).toEqual([{ qubit: 0, clbit: 0 }]);
    expect(deterministicNarrative(context)).toMatch(/QCI Aer CPU/);
    expect(deterministicNarrative(context)).toMatch(/\|00⟩/);
    expect(deterministicNarrative(context)).not.toMatch(/OPENQASM|sk-secret/);
  });
});
