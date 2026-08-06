// Minimal server-sent-events parser.
//
// /api/chat streams `event: <name>` + `data: <json>` frames. Chunk boundaries
// land anywhere — mid-field, mid-JSON, between the two newlines that end a
// frame — so parsing is incremental and never assumes a chunk is a whole frame.

/**
 * @returns {{ push(chunk: string): Array<{event: string, data: any, raw: string}>, flush(): Array<{event: string, data: any, raw: string}> }}
 */
export function createSseParser() {
  let buffer = "";

  const parseFrame = (frame) => {
    let event = "message";
    const dataLines = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue; // blank or comment
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      let value = separator === -1 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return null;
    const raw = dataLines.join("\n");
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { event, data, raw };
  };

  const drain = (final) => {
    const events = [];
    // Frames are separated by a blank line; \r\n\r\n covers proxies that
    // rewrite newlines.
    let index;
    while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const match = /\r?\n\r?\n/.exec(buffer.slice(index));
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + match[0].length);
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
    }
    if (final && buffer.trim()) {
      const parsed = parseFrame(buffer);
      buffer = "";
      if (parsed) events.push(parsed);
    }
    return events;
  };

  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

/**
 * Reads a fetch Response body as a stream of SSE events.
 * @param {Response} response
 */
export async function* readSse(response) {
  if (!response.body) throw new Error("The response carried no body to stream.");
  const parser = createSseParser();
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    for (const event of parser.push(decoder.decode(chunk, { stream: true }))) yield event;
  }
  for (const event of parser.flush()) yield event;
}
