"use client";

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

export function CodeTabs({ tabs }: { tabs: Array<{ id: string; label: string; code: string }> }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="stack-sm">
      <div className="segmented" role="tablist">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={tab.id === current?.id} className={tab.id === current?.id ? "active" : undefined} onClick={() => setActive(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {current ? <CodeBlock code={current.code} label={current.label} /> : null}
    </div>
  );
}
