/**
 * TurnBuildStream — the build timeline for a SINGLE past turn, rendered inline
 * under the assistant message that produced it.
 *
 * The live/active build is shown by the global <BuildStream> (which reads the
 * live event stores). But those stores only ever hold ONE job — the latest —
 * so after a few edits the earlier turns' streams vanished. This component
 * restores per-turn history: each completed assistant turn keeps a
 * `{ type: 'palmkit-build', jobId }` annotation, and here we lazily fetch that
 * job's full event log from /api/jobs and render it with the exact same
 * timeline UI, collapsed by default so the thread stays scannable.
 *
 * Events are cached per jobId in-module, so scrolling past turns doesn't refetch.
 */
import { useEffect, useState } from 'react';
import { BuildStreamView } from './BuildStream';
import type { WorkerEvent } from '~/lib/stores/build-status';

const cache = new Map<string, WorkerEvent[]>();

export function TurnBuildStream({ jobId }: { jobId: string }) {
  const [events, setEvents] = useState<WorkerEvent[] | null>(() => cache.get(jobId) ?? null);

  useEffect(() => {
    let cancelled = false;

    if (cache.has(jobId)) {
      setEvents(cache.get(jobId)!);
    } else {
      (async () => {
        try {
          const resp = await fetch(`/api/jobs?id=${encodeURIComponent(jobId)}`);

          if (!resp.ok) {
            return;
          }

          const data = (await resp.json()) as { events?: WorkerEvent[] };
          const evts = Array.isArray(data.events) ? data.events : [];
          cache.set(jobId, evts);

          if (!cancelled) {
            setEvents(evts);
          }
        } catch {
          // best-effort — a missing past stream just doesn't render
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!events || events.length === 0) {
    return null;
  }

  // A past turn is always finished — render collapsed, marked done.
  return <BuildStreamView events={events} progress={100} currentStep="done" defaultOpen={false} />;
}
