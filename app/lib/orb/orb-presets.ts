/**
 * Orb persona state + per-state shader presets.
 *
 * The liquid-metal orb reacts to the AI's state by morphing its colors,
 * distortion and motion speed. These presets are the "target" values for
 * each state; `useOrbUniforms` lerps between them smoothly.
 *
 * Ported from the reference design (paper-design LiquidMetal shader).
 */

export type PersonaState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep';

/** Shape of the uniform values the orb shader accepts. */
export interface OrbUniforms {
  colorBack: string;
  colorTint: string;
  distortion: number;
  contour: number;
  repetition: number;
  softness: number;
  shiftRed: number;
  shiftBlue: number;
  angle: number;
  speed: number;
  scale: number;
}

/**
 * Per-state target presets. Designed so the orb visibly "changes mood":
 *  - idle:      calm silver, slow breathing
 *  - listening: icy blue, gentle ripple (user is typing)
 *  - thinking:  turbulent amber, fast (model is processing)
 *  - speaking:  bright white, energetic pulse (tokens streaming)
 *  - asleep:    dim slate, barely alive (idle for a long time)
 */
export const ORB_STATE_PRESETS: Record<PersonaState, OrbUniforms> = {
  idle: {
    colorBack: '#0a0a0a',
    colorTint: '#cbd5e1',
    distortion: 0.15,
    contour: 0.4,
    repetition: 2.5,
    softness: 0.35,
    shiftRed: 0.2,
    shiftBlue: 0.2,
    angle: 70,
    speed: 0.35,
    scale: 1.3,
  },
  listening: {
    colorBack: '#0a0a0a',
    colorTint: '#93c5fd',
    distortion: 0.3,
    contour: 0.45,
    repetition: 3,
    softness: 0.4,
    shiftRed: 0.35,
    shiftBlue: 0.5,
    angle: 70,
    speed: 0.7,
    scale: 1.3,
  },
  thinking: {
    colorBack: '#0a0a0a',
    colorTint: '#fbbf24',
    distortion: 0.85,
    contour: 0.8,
    repetition: 5.5,
    softness: 0.3,
    shiftRed: 0.6,
    shiftBlue: 0.1,
    angle: 50,
    speed: 1.7,
    scale: 1.3,
  },
  speaking: {
    colorBack: '#0a0a0a',
    colorTint: '#ffffff',
    distortion: 0.7,
    contour: 0.65,
    repetition: 4.5,
    softness: 0.35,
    shiftRed: 0.4,
    shiftBlue: 0.4,
    angle: 70,
    speed: 1.6,
    scale: 1.3,
  },
  asleep: {
    colorBack: '#0a0a0a',
    colorTint: '#475569',
    distortion: 0.08,
    contour: 0.25,
    repetition: 2,
    softness: 0.5,
    shiftRed: 0.05,
    shiftBlue: 0.05,
    angle: 90,
    speed: 0.12,
    scale: 1.3,
  },
};

/* ---------- color parsing & lerping helpers ---------- */

function parseColor(input: string): [number, number, number, number] {
  // Accepts #rgb, #rrggbb, #rrggbbaa, rgb(), rgba().
  const s = input.trim();

  if (s.startsWith('#')) {
    let hex = s.slice(1);

    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

    return [r, g, b, a];
  }

  const m = s.match(/rgba?\(([^)]+)\)/i);

  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));

    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] === undefined ? 1 : parts[3]];
  }

  return [128, 128, 128, 1];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp two CSS colors and return an `rgba()` string. */
export function lerpColor(from: string, to: string, t: number): string {
  const [r1, g1, b1, a1] = parseColor(from);
  const [r2, g2, b2, a2] = parseColor(to);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  const a = lerp(a1, a2, t);

  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}
