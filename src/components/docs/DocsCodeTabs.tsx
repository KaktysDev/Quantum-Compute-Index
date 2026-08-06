"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function DocsCodeTabs({ examples, label }: { examples: Record<string, string>; label: string }) {
  const languages = Object.keys(examples);
  const [language, setLanguage] = useState(languages[0]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(examples[language]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="docs-code-example">
      <div className="docs-code-toolbar">
        <div role="tablist" aria-label={label}>
          {languages.map((item) => (
            <button role="tab" aria-selected={language === item} className={language === item ? "active" : ""} key={item} onClick={() => setLanguage(item)}>{item}</button>
          ))}
        </div>
        <button className="docs-copy" onClick={copy} aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      </div>
      <pre><code>{examples[language]}</code></pre>
    </div>
  );
}
