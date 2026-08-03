import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { SettingsGroup, SettingsRow, type SettingsNav, type SettingsPage } from '~/components/settings/SettingsSheet';

/**
 * Which model handles which kind of work.
 *
 * The model in the composer writes the replies. It cannot draw a picture — a
 * text model has no image output — so those jobs go to a different model
 * entirely, and until now the user had no say in which.
 *
 * Automatic is the default and stays the default: cheapest model in the
 * catalog that can actually do the job. Cheapest is not always best, though,
 * and "I want that one" is a reasonable thing to want.
 *
 * Nothing here contains a model name. Every candidate comes from the catalog,
 * so a model released tomorrow appears the moment the catalog refreshes.
 */

interface Candidate {
  model: string;
  displayName?: string;
  promptPerM: number | null;
  completionPerM: number | null;
  perSecond: Record<string, number> | null;
  contextTokens: number | null;
  source: string;
  media: {
    durations?: number[];
    aspectRatios?: string[];
    frameImages?: string[];
    generatesAudio?: boolean;
  } | null;
}

interface CapabilityState {
  capability: string;
  assigned: string | null;
  assignedIsStale: boolean;
  autoModel: string | null;
  autoReason: string | null;
  candidates: Candidate[];
  total: number;
}

interface Payload {
  provider: string | null;
  capabilities: CapabilityState[];
}

/** How each capability reads to someone who has not read the code. */
const LABELS: Record<string, { title: string; sub: string; icon: string }> = {
  image: { title: 'Images', sub: 'When you ask for a picture', icon: 'i-ph:image' },
  video: { title: 'Video', sub: 'When you ask for a clip', icon: 'i-ph:film-slate' },
};

/** A price a person can read, in whatever unit the thing is actually sold. */
function priceLabel(c: Candidate): string | null {
  if (c.perSecond) {
    const rates = Object.values(c.perSecond).filter((n) => n >= 0);

    if (rates.length) {
      return `$${Math.min(...rates)}/sec`;
    }
  }

  const p = c.completionPerM ?? c.promptPerM;

  return typeof p === 'number' && p >= 0 ? `$${p}/M` : null;
}

function shortName(c: Candidate): string {
  return c.displayName ?? c.model;
}

async function load(): Promise<Payload | null> {
  try {
    const res = await fetch('/api/account/model-assignments', { credentials: 'same-origin' });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as Payload;
  } catch {
    return null;
  }
}

/* ── One capability's picker ──────────────────────────────────────────────── */

function pickerPage(state: CapabilityState, onChanged: () => void): SettingsPage {
  const meta = LABELS[state.capability] ?? { title: state.capability, sub: '', icon: 'i-ph:cube' };

  return {
    id: `assign-${state.capability}`,
    title: meta.title,
    render: (nav) => <Picker state={state} meta={meta} nav={nav} onChanged={onChanged} />,
  };
}

function Picker({
  state,
  meta,
  nav,
  onChanged,
}: {
  state: CapabilityState;
  meta: { title: string; sub: string };
  nav: SettingsNav;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(state.assigned);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? state.candidates.filter((c) => c.model.toLowerCase().includes(q)) : state.candidates;
  }, [query, state.candidates]);

  const choose = async (model: string | null) => {
    setBusy(model ?? 'auto');

    try {
      const res =
        model === null
          ? await fetch(`/api/account/model-assignments?capability=${encodeURIComponent(state.capability)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
            })
          : await fetch('/api/account/model-assignments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ capability: state.capability, model }),
            });

      const body = (await res.json()) as { ok?: boolean; error?: string };

      if (!body.ok) {
        toast.error(body.error ?? 'Could not save that choice');
        return;
      }

      setChosen(model);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="mb-4 text-[14px] leading-relaxed text-palmkit-elements-textSecondary">{meta.sub}.</p>

      <SettingsGroup>
        <SettingsRow
          first
          icon="i-ph:magic-wand"
          label="Automatic"
          sub={state.autoModel ? `Currently ${state.autoModel}` : 'No model available'}
          onClick={chosen === null ? undefined : () => void choose(null)}
          right={
            busy === 'auto' ? (
              <span className="i-svg-spinners:90-ring-with-bg h-4 w-4 text-palmkit-elements-textTertiary" />
            ) : chosen === null ? (
              <span className="text-[13px] font-medium text-green-500">In use</span>
            ) : null
          }
        />
      </SettingsGroup>

      {state.candidates.length > 6 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${state.total} models`}
          aria-label="Search models"
          className={classNames(
            'mb-3 w-full rounded-2xl bg-palmkit-elements-background-depth-1 px-4 py-3 text-[16px]',
            'text-palmkit-elements-textPrimary outline-none placeholder:text-palmkit-elements-textTertiary',
            'appearance-none border-0 focus-visible:outline-none',
          )}
        />
      )}

      <SettingsGroup title={`${visible.length} can do this`}>
        {visible.map((c, i) => (
          <SettingsRow
            key={c.model}
            first={i === 0}
            icon={chosen === c.model ? 'i-ph:check-circle-fill' : 'i-ph:circle'}
            label={shortName(c)}
            sub={[priceLabel(c), c.media?.frameImages?.includes('first_frame') ? 'can start from an image' : null]
              .filter(Boolean)
              .join(' · ')}
            onClick={chosen === c.model ? undefined : () => void choose(c.model)}
            right={
              busy === c.model ? (
                <span className="i-svg-spinners:90-ring-with-bg h-4 w-4 text-palmkit-elements-textTertiary" />
              ) : chosen === c.model ? (
                <span className="text-[13px] font-medium text-green-500">In use</span>
              ) : null
            }
          />
        ))}
      </SettingsGroup>

      {state.candidates.length === 0 && (
        <p className="px-1 text-[13px] leading-snug text-palmkit-elements-textTertiary">
          Your connected provider has no model that can do this. Settings &rarr; Model providers &rarr; Refresh
          capabilities re-reads what is available.
        </p>
      )}

      <button
        onClick={nav.pop}
        className="mt-6 h-12 w-full rounded-full bg-palmkit-elements-background-depth-1 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
      >
        Back
      </button>
    </div>
  );
}

/* ── The list of capabilities ─────────────────────────────────────────────── */

export function modelAssignmentsPage(): SettingsPage {
  return {
    id: 'model-assignments',
    title: 'Model assignment',
    render: (nav) => <ModelAssignmentsPage nav={nav} />,
  };
}

function ModelAssignmentsPage({ nav }: { nav: SettingsNav }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setData(await load());
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <span className="i-svg-spinners:90-ring-with-bg h-7 w-7 text-palmkit-elements-textTertiary" />
      </div>
    );
  }

  if (!data?.provider) {
    return (
      <div className="py-10 text-center">
        <span className="i-ph:plug mb-3 h-8 w-8 text-palmkit-elements-textTertiary" />
        <div className="text-[15px] text-palmkit-elements-textPrimary">No provider connected</div>
        <p className="mt-1 text-[13px] text-palmkit-elements-textTertiary">
          Connect one in Model providers, then choose which model handles what.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[14px] leading-relaxed text-palmkit-elements-textSecondary">
        The model you pick in the chat box writes every reply — that one is chosen there, not here. It cannot draw a
        picture or render a video, so those two jobs go elsewhere. Left automatic, they go to the cheapest model that
        can actually do them.
      </p>

      <SettingsGroup>
        {data.capabilities.map((c, i) => {
          const meta = LABELS[c.capability] ?? { title: c.capability, sub: '', icon: 'i-ph:cube' };
          const current = c.assigned ?? c.autoModel;

          return (
            <SettingsRow
              key={c.capability}
              first={i === 0}
              icon={meta.icon}
              label={meta.title}
              sub={
                c.assignedIsStale
                  ? `${c.assigned} is no longer available — using ${c.autoModel ?? 'nothing'}`
                  : c.total === 0
                    ? 'No model available'
                    : (current ?? 'No model available')
              }
              chevron
              onClick={() => nav.push(pickerPage(c, () => void reload()))}
              right={
                c.assigned && !c.assignedIsStale ? (
                  <span className="text-[13px] text-palmkit-elements-textTertiary">Chosen</span>
                ) : c.assignedIsStale ? (
                  <span className="i-ph:warning-circle h-4 w-4 text-amber-500" />
                ) : (
                  <span className="text-[13px] text-palmkit-elements-textTertiary">Auto</span>
                )
              }
            />
          );
        })}
      </SettingsGroup>

      <p className="px-1 text-[12px] leading-snug text-palmkit-elements-textTertiary">
        Every option comes from what {data.provider} publishes about its own models, so a model released tomorrow shows
        up as soon as capabilities are refreshed.
      </p>

      <button
        onClick={nav.pop}
        className="mt-6 h-12 w-full rounded-full bg-palmkit-elements-background-depth-1 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
      >
        Back to settings
      </button>
    </div>
  );
}
