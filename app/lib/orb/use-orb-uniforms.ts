import { useEffect, useRef, useState } from 'react';
import { ORB_STATE_PRESETS, lerpColor, type OrbUniforms, type PersonaState } from './orb-presets';

const KEYS = Object.keys(ORB_STATE_PRESETS.idle) as (keyof OrbUniforms)[];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpUniforms(from: OrbUniforms, to: OrbUniforms, t: number): OrbUniforms {
  const out = {} as OrbUniforms;

  for (const k of KEYS) {
    const a = from[k];
    const b = to[k];

    if (typeof a === 'string' && typeof b === 'string') {
      out[k] = lerpColor(a, b, t) as never;
    } else {
      out[k] = lerp(a as number, b as number, t) as never;
    }
  }

  return out;
}

/**
 * Smoothly animates the orb's shader uniforms toward the preset for the given
 * `state`. Runs a requestAnimationFrame loop that lerps current values toward
 * the target each frame. Returns the current (animated) uniforms.
 */
export function useOrbUniforms(state: PersonaState): OrbUniforms {
  const target = ORB_STATE_PRESETS[state];
  const currentRef = useRef<OrbUniforms>(target);
  const [uniforms, setUniforms] = useState<OrbUniforms>(target);
  const targetRef = useRef<OrbUniforms>(target);

  useEffect(() => {
    targetRef.current = target;

    let raf = 0;

    const tick = () => {
      const cur = currentRef.current;
      const tgt = targetRef.current;
      const next = lerpUniforms(cur, tgt, 0.1);
      currentRef.current = next;
      setUniforms(next);

      const stillMoving = KEYS.some((k) => {
        const a = next[k];
        const b = tgt[k];

        if (typeof a === 'string' || typeof b === 'string') {
          return a !== b;
        }

        return Math.abs((a as number) - (b as number)) > 0.001;
      });

      if (stillMoving) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [state, target]);

  return uniforms;
}
