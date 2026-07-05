/**
 * PalmkitLoader — the brand loading indicator (Design System v2).
 *
 * A glass card holding the Palmkit mark (`>_` + three palm fronds) with a
 * white light-trace running along the strokes, a diagonal shine sweep and a
 * soft accent glow. Ported 1:1 from the approved loader source (trace
 * dasharray 56/260 @ 1.55s linear, shine 2.2s).
 *
 * RULE: this is the ONLY loading indicator in the product. Sizes in use:
 *   148 — app boot        64 — preview starting
 *    22 — BuildStream head 16 — inside the send button
 */
import { memo } from 'react';

export interface PalmkitLoaderProps {
  size?: number;
  className?: string;

  /** Bare mark + trace without the glass card — for tiny inline slots (≤24px). */
  bare?: boolean;
}

const KEYFRAMES = `
@keyframes pk-loader-trace { to { stroke-dashoffset: -316; } }
@keyframes pk-loader-shine { 60%, 100% { transform: translateX(70%) rotate(22deg); } }
@media (prefers-reduced-motion: reduce) {
  .pk-loader-trace, .pk-loader-shine { animation: none !important; }
}
`;

export const PalmkitLoader = memo(({ size = 148, className = '', bare = false }: PalmkitLoaderProps) => {
  const markPaths = (
    <>
      <path d="M17 36 L40 52 L17 68" />
      <path d="M40 14 L40 37" />
      <path d="M61 11 L52 39" />
      <path d="M79 27 L65 49" />
      <path d="M51 71 L78 71" />
    </>
  );

  const trace = 'M17 36 L40 52 L17 68 M40 14 L40 37 M61 11 L52 39 M79 27 L65 49 M51 71 L78 71';

  const icon = (strokeColor: string, traceWidth: number) => (
    <svg
      viewBox="0 0 88 88"
      aria-hidden="true"
      style={{
        width: bare ? size : Math.round(size * 0.52),
        height: bare ? size : Math.round(size * 0.52),
        overflow: 'visible',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <g
        fill="none"
        stroke={strokeColor}
        strokeWidth={Math.max(8, Math.round(size * (bare ? 0.55 : 0.082)))}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {markPaths}
      </g>
      <path
        className="pk-loader-trace"
        d={trace}
        fill="none"
        stroke="#ffffff"
        strokeWidth={traceWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: '56 260',
          animation: 'pk-loader-trace 1.55s linear infinite',
          filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.95))',
        }}
      />
    </svg>
  );

  if (bare) {
    return (
      <span
        className={className}
        role="status"
        aria-label="Loading"
        style={{ display: 'inline-flex', width: size, height: size }}
      >
        <style>{KEYFRAMES}</style>
        {icon('currentColor', Math.max(2, size * 0.12))}
      </span>
    );
  }

  return (
    <div
      className={className}
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size, position: 'relative', display: 'grid', placeItems: 'center' }}
    >
      <style>{KEYFRAMES}</style>
      {/* glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          filter: 'blur(10px)',
          background: 'radial-gradient(circle, var(--pk-accent-dim, rgba(255,255,255,.12)), transparent 63%)',
        }}
      />
      {/* glass card */}
      <div
        style={{
          width: Math.round(size * 0.86),
          height: Math.round(size * 0.86),
          borderRadius: Math.round(size * 0.21),
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          position: 'relative',
          backdropFilter: 'blur(16px) saturate(145%)',
          WebkitBackdropFilter: 'blur(16px) saturate(145%)',
          background: 'linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))',
          border: '1px solid var(--pk-glass-border-hi, rgba(255,255,255,0.12))',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -16px 36px rgba(0,0,0,0.18), 0 18px 50px rgba(0,0,0,0.44)',
        }}
      >
        <div
          className="pk-loader-shine"
          style={{
            content: '""',
            position: 'absolute',
            inset: '-42%',
            transform: 'translateX(-72%) rotate(22deg)',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent)',
            animation: 'pk-loader-shine 2.2s ease-in-out infinite',
          }}
        />
        {icon('var(--pk-loader-mark, #080808)', Math.max(2.5, size * 0.02))}
      </div>
    </div>
  );
});

PalmkitLoader.displayName = 'PalmkitLoader';
