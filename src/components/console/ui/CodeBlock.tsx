import { CopyButton } from "./CopyButton";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="code-block">
      <pre aria-label={label}>
        <code>{code}</code>
      </pre>
      <span className="copy">
        <CopyButton value={code} label="Copy code" />
      </span>
    </div>
  );
}
