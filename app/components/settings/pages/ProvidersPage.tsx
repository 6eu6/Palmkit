import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { SettingsGroup, SettingsRow, type SettingsNav } from '~/components/settings/SettingsSheet';
import { descriptorsStore, loadDescriptors, refreshProviderCapabilities } from '~/lib/stores/model-capabilities';
import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';

/**
 * Model providers — connect one, then manage it.
 *
 * First time through it is three steps, because there genuinely are three
 * decisions and pretending otherwise makes the first one confusing: which
 * provider, which key, which models. Afterwards it is a list — the wizard
 * never comes back, because re-answering settled questions to change one of
 * them is the thing that makes settings feel hostile.
 */

interface ProviderDef {
  id: string;
  name: string;
  blurb: string;
  keyUrl: string;

  /** Providers that publish capabilities need no probing at all. */
  selfDescribing?: boolean;
}

/**
 * The providers worth offering first. Not the full list of twenty-two — a
 * grid of everything is a worse first decision than a grid of the ones most
 * people want, with the rest one tap further on.
 */
export const POPULAR_PROVIDERS: ProviderDef[] = [
  {
    id: 'OpenRouter',
    name: 'OpenRouter',
    blurb: 'One key, 300+ models from every vendor',
    keyUrl: 'https://openrouter.ai/keys',
    selfDescribing: true,
  },
  { id: 'Anthropic', name: 'Anthropic', blurb: 'Claude models', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'OpenAI', name: 'OpenAI', blurb: 'GPT and o-series', keyUrl: 'https://platform.openai.com/api-keys' },
  {
    id: 'Google',
    name: 'Google',
    blurb: 'Gemini models',
    keyUrl: 'https://aistudio.google.com/apikey',
    selfDescribing: true,
  },
  { id: 'Groq', name: 'Groq', blurb: 'Fast open models', keyUrl: 'https://console.groq.com/keys' },
  { id: 'Deepseek', name: 'DeepSeek', blurb: 'Strong and cheap', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'xAI', name: 'xAI', blurb: 'Grok models', keyUrl: 'https://console.x.ai' },
  { id: 'Mistral', name: 'Mistral', blurb: 'European models', keyUrl: 'https://console.mistral.ai/api-keys' },
];

interface StoredKey {
  stored: boolean;
  provider?: string;
}

async function fetchStoredKey(): Promise<StoredKey> {
  try {
    const res = await fetch('/api/account/api-key', { credentials: 'same-origin' });

    if (!res.ok) {
      return { stored: false };
    }

    return (await res.json()) as StoredKey;
  } catch {
    return { stored: false };
  }
}

/* ── Step 1 — pick a provider ─────────────────────────────────────────────── */

function ProviderGrid({ onPick }: { onPick: (p: ProviderDef) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {POPULAR_PROVIDERS.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p)}
          className={classNames(
            'flex flex-col items-start gap-1 rounded-2xl border border-palmkit-elements-borderColor',
            'bg-palmkit-elements-background-depth-1 px-3.5 py-3 text-left transition active:scale-[0.98]',
            'hover:border-[var(--pk-accent)]',
          )}
        >
          <span className="text-[15px] font-semibold text-palmkit-elements-textPrimary">{p.name}</span>
          <span className="text-[12px] leading-snug text-palmkit-elements-textTertiary">{p.blurb}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Step 2 — paste the key ───────────────────────────────────────────────── */

function KeyStep({ provider, onSaved, onBack }: { provider: ProviderDef; onSaved: () => void; onBack: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!key.trim() || busy) {
      return;
    }

    setBusy(true);

    try {
      const res = await fetch('/api/account/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ apiKey: key.trim(), provider: provider.id }),
      });

      const body = (await res.json()) as { ok?: boolean; error?: string };

      if (!body.ok) {
        toast.error(body.error ?? 'Could not save the key');
        return;
      }

      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-4 text-[14px] leading-relaxed text-palmkit-elements-textSecondary">
        Paste your {provider.name} key. It is encrypted before it is stored and is only ever decrypted on the server,
        when a request is made on your behalf.
      </p>

      <input
        autoFocus
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        placeholder={`${provider.name} API key`}
        aria-label={`${provider.name} API key`}
        className={classNames(
          'w-full rounded-2xl bg-palmkit-elements-background-depth-1 px-4 py-3.5 text-[16px]',
          'text-palmkit-elements-textPrimary outline-none placeholder:text-palmkit-elements-textTertiary',
          'appearance-none border-0 focus-visible:outline-none',
        )}
      />

      <a
        href={provider.keyUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 px-1 text-[13px] text-[var(--pk-accent)]"
      >
        Get a {provider.name} key
        <span className="i-ph:arrow-square-out h-3.5 w-3.5" />
      </a>

      <div className="mt-6 flex gap-2">
        <button
          onClick={onBack}
          className="h-12 flex-1 rounded-full bg-palmkit-elements-background-depth-1 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
        >
          Back
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !key.trim()}
          className={classNames(
            'h-12 flex-[2] rounded-full text-[15px] font-semibold transition active:scale-[0.98]',
            busy || !key.trim()
              ? 'cursor-not-allowed bg-palmkit-elements-background-depth-1 text-palmkit-elements-textTertiary'
              : 'bg-blue-600 text-white hover:bg-blue-500',
          )}
        >
          {busy ? 'Saving…' : 'Save key'}
        </button>
      </div>
    </div>
  );
}

/* ── Step 3 — establish what the models can do ────────────────────────────── */

function CapabilityStep({ provider, onDone }: { provider: ProviderDef; onDone: () => void }) {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [count, setCount] = useState(0);
  const descriptors = useStore(descriptorsStore);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const n = await refreshProviderCapabilities(provider.id);

      if (!cancelled) {
        setCount(n);
        setState(n > 0 ? 'done' : 'failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider.id]);

  const mine = Object.values(descriptors).filter((d) => d.provider === provider.id);
  const summary = summarise(mine);

  return (
    <div>
      {state === 'working' && (
        <div className="flex flex-col items-center py-12 text-center">
          <span className="i-svg-spinners:90-ring-with-bg mb-4 h-8 w-8 text-[var(--pk-accent)]" />
          <div className="text-[15px] font-medium text-palmkit-elements-textPrimary">Reading what these models do</div>
          <p className="mt-1 max-w-[280px] text-[13px] leading-snug text-palmkit-elements-textTertiary">
            {provider.selfDescribing
              ? `${provider.name} publishes this, so nothing needs testing.`
              : `${provider.name} publishes nothing, so a few one-token requests establish it. Costs a fraction of a cent, once.`}
          </p>
        </div>
      )}

      {state === 'failed' && (
        <div className="py-10 text-center">
          <span className="i-ph:warning-circle mb-3 h-8 w-8 text-palmkit-elements-textTertiary" />
          <div className="text-[15px] text-palmkit-elements-textPrimary">Could not read the model list</div>
          <p className="mt-1 text-[13px] text-palmkit-elements-textTertiary">
            The key is saved. You can try again from the provider&rsquo;s row.
          </p>
        </div>
      )}

      {state === 'done' && (
        <>
          <div className="py-6 text-center">
            <span className="i-ph:check-circle-fill mb-3 h-9 w-9 text-green-500" />
            <div className="text-[17px] font-semibold text-palmkit-elements-textPrimary">
              {count} models from {provider.name}
            </div>
          </div>
          <CapabilitySummary summary={summary} />
        </>
      )}

      <button
        onClick={onDone}
        disabled={state === 'working'}
        className={classNames(
          'mt-6 h-12 w-full rounded-full text-[15px] font-semibold transition active:scale-[0.98]',
          state === 'working'
            ? 'cursor-not-allowed bg-palmkit-elements-background-depth-1 text-palmkit-elements-textTertiary'
            : 'bg-blue-600 text-white hover:bg-blue-500',
        )}
      >
        Done
      </button>
    </div>
  );
}

interface Summary {
  total: number;
  vision: number;
  imageOut: number;
  videoOut: number;
  tools: number;
  steerable: number;
  verified: number;
}

function summarise(models: ModelDescriptor[]): Summary {
  return {
    total: models.length,
    vision: models.filter((d) => d.input.image).length,
    imageOut: models.filter((d) => d.output.image).length,
    videoOut: models.filter((d) => d.output.video).length,
    tools: models.filter((d) => d.tools.functionCalling).length,
    steerable: models.filter((d) => d.reasoning.controllable).length,

    /* Anything above the heuristic floor is an established fact. */
    verified: models.filter((d) => d.source !== 'heuristic').length,
  };
}

function CapabilitySummary({ summary }: { summary: Summary }) {
  const rows: { label: string; value: number; icon: string }[] = [
    { label: 'Can see images', value: summary.vision, icon: 'i-ph:eye' },
    { label: 'Generate images', value: summary.imageOut, icon: 'i-ph:image' },
    { label: 'Generate video', value: summary.videoOut, icon: 'i-ph:film-slate' },
    { label: 'Can use tools', value: summary.tools, icon: 'i-ph:wrench' },
    { label: 'Thinking adjustable', value: summary.steerable, icon: 'i-ph:brain' },
  ];

  return (
    <>
      <SettingsGroup title="What they can do">
        {rows.map((row, i) => (
          <SettingsRow
            key={row.label}
            first={i === 0}
            icon={row.icon}
            label={row.label}
            right={<span className="text-[15px] tabular-nums text-palmkit-elements-textTertiary">{row.value}</span>}
          />
        ))}
      </SettingsGroup>

      <p className="px-1 text-[12px] leading-snug text-palmkit-elements-textTertiary">
        {summary.verified === summary.total
          ? 'Every one of these was established from the provider or by testing — none of it is guessed from model names.'
          : `${summary.verified} of ${summary.total} established from the provider or by testing; the rest are inferred and marked unverified.`}
      </p>
    </>
  );
}

/* ── The page itself ──────────────────────────────────────────────────────── */

export function providersPage(): { id: string; title: string; render: (nav: SettingsNav) => React.ReactNode } {
  return {
    id: 'providers',
    title: 'Model providers',
    render: (nav) => <ProvidersPage nav={nav} />,
  };
}

function ProvidersPage({ nav }: { nav: SettingsNav }) {
  const [stored, setStored] = useState<StoredKey | null>(null);
  const [step, setStep] = useState<'list' | 'pick' | 'key' | 'capabilities'>('list');
  const [chosen, setChosen] = useState<ProviderDef | null>(null);
  const descriptors = useStore(descriptorsStore);

  const reload = async () => {
    const s = await fetchStoredKey();
    setStored(s);

    /*
     * A user with no key at all goes straight into the flow — showing them an
     * empty list with an "Add" button is a step that exists only to be tapped.
     */
    setStep(s.stored ? 'list' : 'pick');

    if (s.stored && s.provider) {
      void loadDescriptors(s.provider);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  if (!stored) {
    return (
      <div className="flex justify-center py-16">
        <span className="i-svg-spinners:90-ring-with-bg h-7 w-7 text-palmkit-elements-textTertiary" />
      </div>
    );
  }

  if (step === 'pick') {
    return (
      <div>
        <p className="mb-4 text-[14px] leading-relaxed text-palmkit-elements-textSecondary">
          Choose where your models come from. OpenRouter is the simplest — one key reaches every vendor.
        </p>
        <ProviderGrid
          onPick={(p) => {
            setChosen(p);
            setStep('key');
          }}
        />
        {stored.stored && (
          <button
            onClick={() => setStep('list')}
            className="mt-5 h-12 w-full rounded-full bg-palmkit-elements-background-depth-1 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (step === 'key' && chosen) {
    return (
      <KeyStep
        provider={chosen}
        onBack={() => setStep('pick')}
        onSaved={() => {
          setStored({ stored: true, provider: chosen.id });
          setStep('capabilities');
        }}
      />
    );
  }

  if (step === 'capabilities' && chosen) {
    return <CapabilityStep provider={chosen} onDone={() => void reload()} />;
  }

  const activeProvider = POPULAR_PROVIDERS.find((p) => p.id === stored.provider) ?? {
    id: stored.provider ?? 'Unknown',
    name: stored.provider ?? 'Unknown',
    blurb: '',
    keyUrl: '',
  };
  const mine = Object.values(descriptors).filter((d) => d.provider === activeProvider.id);

  return (
    <div>
      <SettingsGroup title="Connected">
        <SettingsRow
          first
          icon="i-ph:key"
          label={activeProvider.name}
          sub={mine.length ? `${mine.length} models` : 'Key saved'}
          right={<span className="i-ph:check-circle-fill h-5 w-5 text-green-500" />}
        />
        <SettingsRow
          icon="i-ph:arrows-clockwise"
          label="Refresh capabilities"
          sub="Re-read what these models can do"
          onClick={async () => {
            const n = await refreshProviderCapabilities(activeProvider.id);
            toast[n > 0 ? 'success' : 'error'](n > 0 ? `Read ${n} models` : 'Could not read the model list');
          }}
        />
        <SettingsRow
          icon="i-ph:pencil-simple"
          label="Replace key"
          sub="The stored key is never shown again"
          onClick={() => {
            setChosen(activeProvider);
            setStep('key');
          }}
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow first icon="i-ph:plus" label="Use a different provider" chevron onClick={() => setStep('pick')} />
      </SettingsGroup>

      {mine.length > 0 && <CapabilitySummary summary={summarise(mine)} />}

      <button
        onClick={nav.pop}
        className="mt-6 h-12 w-full rounded-full bg-palmkit-elements-background-depth-1 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
      >
        Back to settings
      </button>
    </div>
  );
}
