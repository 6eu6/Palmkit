/**
 * VideoRenderer
 * =============
 * Renders the result of the `generate_video` tool.
 *
 * A generated video costs real money — between about ten cents and three
 * dollars depending on the model and the length — so what it cost and which
 * model produced it are shown, not hidden. That is the difference between a
 * user who understands their bill and one who does not.
 *
 * `playable: false` means the copy in storage could not be made and the link
 * points at the provider, which requires an API key. The player is not shown
 * in that case, because a <video> pointing there renders a broken frame.
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface VideoRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface GenerateVideoResult {
  ok: boolean;
  model?: string;
  whyThisModel?: string;
  url?: string;
  playable?: boolean;
  prompt?: string;
  durationSeconds?: number;
  aspectRatio?: string | null;
  startedFromImage?: boolean;
  withAudio?: boolean;
  costUsd?: number | null;
  estimatedCostUsd?: number | null;
  note?: string;
  error?: string;
  hint?: string;
  jobId?: string;
}

function money(v: number | null | undefined): string | null {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : null;
}

function VideoRendererImpl({ result }: VideoRendererProps) {
  const [failed, setFailed] = useState(false);
  const data = result as GenerateVideoResult;

  if (!data.ok || !data.url) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="generate_video"
          label="Generated Video"
          iconClass="i-ph:film-slate"
          success={false}
          error={data.error}
        />
        {data.hint && (
          <div className="mt-2 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
            <div className="i-ph:info inline-block mr-1" />
            {data.hint}
          </div>
        )}
        {/* The job is already billed; the id is how it can still be collected. */}
        {data.jobId && <div className="mt-2 text-[11px] text-palmkit-elements-textTertiary">Job {data.jobId}</div>}
      </div>
    );
  }

  const cost = money(data.costUsd) ?? money(data.estimatedCostUsd);

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="generate_video"
        label="Generated Video"
        iconClass="i-ph:film-slate"
        success
        accentColor="bg-violet-500/10"
        meta={
          <>
            {data.durationSeconds && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.durationSeconds}s</span>
            )}
            {data.aspectRatio && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.aspectRatio}</span>
            )}
            {cost && <span className="text-xs text-palmkit-elements-textSecondary">{cost}</span>}
          </>
        }
      />

      {data.playable !== false && !failed ? (
        <video
          src={data.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="w-full max-h-[70vh] rounded-lg bg-black"
        />
      ) : (
        <div className="rounded-lg border border-palmkit-elements-borderColor p-4 text-center">
          <div className="i-ph:film-slate mx-auto mb-2 h-6 w-6 text-palmkit-elements-textTertiary" />
          <div className="text-[13px] text-palmkit-elements-textSecondary">
            The video was generated but could not be saved for playback here.
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <DownloadButton
          data={data.playable !== false ? data.url : undefined}
          filename={`generated-video-${Date.now()}.mp4`}
          mimeType="video/mp4"
          label="Download MP4"
          iconClass="i-ph:download-simple"
          disabled={data.playable === false}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-palmkit-elements-textTertiary">
        {data.model && <span>{data.model}</span>}
        {data.whyThisModel && <span>· {data.whyThisModel}</span>}
        {data.startedFromImage && <span>· from your image</span>}
        {data.withAudio && <span>· with audio</span>}
      </div>

      {data.note && (
        <div className="mt-2 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
          <div className="i-ph:info inline-block mr-1" />
          {data.note}
        </div>
      )}

      {data.prompt && (
        <CollapsibleSection title="Prompt" defaultExpanded={false}>
          <p className="text-xs text-palmkit-elements-textSecondary whitespace-pre-wrap">{data.prompt}</p>
        </CollapsibleSection>
      )}
    </div>
  );
}

export const VideoRenderer = memo(VideoRendererImpl);
