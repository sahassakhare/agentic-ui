/**
 * Minimal React portal that embeds a published Agentic Experience.
 *
 * The contract is headless: the SDK fetches a *render manifest* (steps, widget
 * names, branch conditions) and this portal renders it with ITS OWN components.
 * Our platform ships the data + control-flow; the portal ships the pixels. This
 * file is illustrative — it is excluded from the package build (see tsconfig).
 */
import { useEffect, useMemo, useState } from 'react';
import { createEmbedClient, resolveNext, stepById, type PublishedManifest } from '@infra-tools/aep-embed-sdk';

// The portal maps widget names → its own components. Each receives the current
// state and an `onChange(field, value)` to capture input that branches drive.
type WidgetProps = { state: Record<string, unknown>; onChange: (field: string, value: unknown) => void };
const WIDGETS: Record<string, (p: WidgetProps) => JSX.Element> = {
  'category-picker': ({ onChange }) => (
    <select onChange={(e) => onChange('category', e.target.value)} defaultValue="">
      <option value="" disabled>Choose a category…</option>
      <option value="billing">Billing</option>
      <option value="technical">Technical</option>
    </select>
  ),
  'priority-picker': ({ onChange }) => (
    <select onChange={(e) => onChange('priority', e.target.value)} defaultValue="normal">
      <option value="normal">Normal</option>
      <option value="high">High</option>
    </select>
  ),
  // …the portal supplies one component per manifest widget name.
};

const client = createEmbedClient({
  catalogUrl: import.meta.env.VITE_CATALOG_URL,
  tenant: 'acme',
  key: import.meta.env.VITE_EMBED_KEY, // public, origin-pinned
});

export function App(): JSX.Element {
  const [manifest, setManifest] = useState<PublishedManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [stepId, setStepId] = useState<string | null>(null);

  useEffect(() => {
    client.getManifest('support-ticket')
      .then((m) => { setManifest(m); setStepId(m.workflow?.steps[0]?.id ?? null); })
      .catch((e) => setError(String(e)));
  }, []);

  const step = useMemo(
    () => (manifest?.workflow && stepId ? stepById(manifest.workflow.steps, stepId) : undefined),
    [manifest, stepId],
  );

  if (error) return <div className="error">Could not load experience: {error}</div>;
  if (!manifest || !step) return <div>Loading…</div>;

  const Widget = WIDGETS[step.widget] ?? (() => <em>Unknown widget: {step.widget}</em>);
  const onChange = (field: string, value: unknown) => setState((s) => ({ ...s, [field]: value }));
  const next = () => {
    const target = resolveNext(step.next, state); // branch conditions evaluated client-side
    setStepId(target); // null → journey complete
  };

  return (
    <section className="aep-embed">
      <h1>{manifest.experience.title}</h1>
      {step.section && <h2>{step.section}</h2>}
      <Widget state={state} onChange={onChange} />
      <button onClick={next}>{step.next === null ? 'Finish' : 'Next'}</button>
    </section>
  );
}
