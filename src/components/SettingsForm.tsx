"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { InlineAlert, Panel } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";

type Preferences = { completionEmails?: boolean; failureAlerts?: boolean; defaultRouting?: string; theme?: string };

export default function SettingsForm({
  initial,
}: {
  initial: { fullName: string; email: string; organization: string; preferences: Preferences };
}) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [organization, setOrganization] = useState(initial.organization);
  const [completion, setCompletion] = useState(initial.preferences.completionEmails ?? true);
  const [failure, setFailure] = useState(initial.preferences.failureAlerts ?? true);
  const [routing, setRouting] = useState(initial.preferences.defaultRouting ?? "balanced");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          organization_name: organization,
          preferences: { ...initial.preferences, completionEmails: completion, failureAlerts: failure, defaultRouting: routing },
        }),
      });
      if (!response.ok) throw new Error(apiErrorMessage(await response.json().catch(() => null), "Settings could not be saved."));
      setSaved(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const touch = () => setSaved(false);

  return (
    <form className="stack" onSubmit={save}>
      <Panel title="Profile">
        <div className="form-grid two" style={{ padding: 0 }}>
          <label className="field">
            Full name
            <input className="input" value={fullName} onChange={(event) => { setFullName(event.target.value); touch(); }} autoComplete="name" />
          </label>
          <label className="field">
            Email
            <input className="input" value={initial.email} disabled />
          </label>
        </div>
      </Panel>

      <Panel title="Workspace">
        <label className="field" style={{ maxWidth: 420 }}>
          Workspace name
          <input className="input" value={organization} onChange={(event) => { setOrganization(event.target.value); touch(); }} />
        </label>
      </Panel>

      <Panel title="Notifications">
        <div className="stack-sm">
          <label className="setting-row">
            <span>
              <b>Completion emails</b>
              <small>Email when a long-running QPU job finishes.</small>
            </span>
            <input type="checkbox" className="switch" checked={completion} onChange={(event) => { setCompletion(event.target.checked); touch(); }} />
          </label>
          <label className="setting-row">
            <span>
              <b>Failure alerts</b>
              <small>Notify workspace owners when a provider fails a job.</small>
            </span>
            <input type="checkbox" className="switch" checked={failure} onChange={(event) => { setFailure(event.target.checked); touch(); }} />
          </label>
        </div>
      </Panel>

      <Panel title="Routing default" description="Used by the assistant when a request does not name a routing mode.">
        <label className="field" style={{ maxWidth: 260 }}>
          Routing mode
          <select className="input" value={routing} onChange={(event) => { setRouting(event.target.value); touch(); }}>
            <option value="balanced">Balanced</option>
            <option value="cost">Lowest cost</option>
            <option value="speed">Shortest queue</option>
            <option value="quality">Highest fidelity</option>
          </select>
        </label>
      </Panel>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="form-actions">
        {saved ? <span className="row muted"><Check size={14} /> Saved</span> : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : null}
          Save changes
        </button>
      </div>
    </form>
  );
}
