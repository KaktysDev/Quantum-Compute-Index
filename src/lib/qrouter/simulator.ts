import { parseQASM, runSimulation } from "quantum-computer-js";
import type { CircuitAnalysis } from "./types";

export async function simulateCircuit(analysis: CircuitAnalysis, shots: number) {
  if (analysis.qubits > 30) throw new Error("Local state-vector simulation supports at most 30 qubits.");
  const started=performance.now(),result=await runSimulation(parseQASM(analysis.normalizedQasm2),{shots,optimize:true});
  const counts:Record<string,number>={};for(const[state,probability]of Object.entries(result.probabilities)){const count=Math.round(probability*shots);if(count>0)counts[state]=count;}
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0),largest=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];if(largest&&total!==shots)counts[largest[0]]+=shots-total;
  return { counts, probabilities:result.probabilities, shots, backend:"qci-aer-gpu", executionMs:Math.round((performance.now()-started)*100)/100, metadata:{engine:"quantum-computer-js state vector",qubits:analysis.qubits,depth:analysis.depth} };
}
