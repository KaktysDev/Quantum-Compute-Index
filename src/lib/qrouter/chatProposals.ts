export interface ChatProposal {
  name?: string;
  circuit?: string;
  repository?: { url: string; ref?: string; path: string };
  format?: "openqasm2" | "openqasm3";
  shots?: number;
  target?: string;
  routing_mode?: "balanced" | "cost" | "speed" | "quality";
  constraints?: { maxCost?: number; kind?: "qpu" | "simulator"; minFidelity?: number };
  note?: string;
}

/** Stable per assistant-message position: retries replay, later requests rerun. */
export function proposalIdempotencyKey(messageId: number, proposalIndex: number): string {
  if (!Number.isSafeInteger(messageId) || messageId < 1) throw new Error("A persisted assistant message is required.");
  if (!Number.isInteger(proposalIndex) || proposalIndex < 0 || proposalIndex > 9) throw new Error("Invalid proposal position.");
  return `qrouter-chat-${messageId}-${proposalIndex}`;
}

/**
 * Remove the assistant-only proposal fence from visible markdown and normalize
 * both the original single-job payload and the multi-job array payload used by
 * repository batch requests. The execution cards still validate/quote every
 * item independently before enabling confirmation.
 */
export function splitChatProposals(content: string): { body: string; proposals: ChatProposal[] } {
  const match = /```qrouter-proposal\s*\n([\s\S]*?)```/.exec(content);
  if (!match) return { body: content, proposals: [] };
  let proposals: ChatProposal[] = [];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    const items = Array.isArray(parsed) ? parsed.slice(0, 10) : [parsed];
    proposals = items.filter(
      (item): item is ChatProposal => Boolean(item && typeof item === "object" && !Array.isArray(item)),
    );
  } catch {
    proposals = [];
  }
  return { body: content.replace(match[0], "").trimEnd(), proposals };
}
