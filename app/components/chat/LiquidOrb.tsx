import { useEffect, useState } from 'react';
import { LiquidMetal } from '@paper-design/shaders-react';
import { useOrbUniforms } from '~/lib/orb/use-orb-uniforms';
import type { PersonaState } from '~/lib/orb/orb-presets';

/**
 * LiquidOrb — a circular liquid-metal orb (real WebGL shader) that reacts to
 * the AI's persona state. Sits at the top-centre of the viewport on the welcome
 * screen, above the greeting + input. Pure visual: pointer-events: none.
 *
 * Ported from the uploaded reference design. Loaded client-only (lazy) so the
 * WebGL shader never runs during SSR.
 */

/** Internal canvas resolution; scaled down via CSS transform. */
const INTERNAL_SIZE = 200;

interface LiquidOrbProps {
  state: PersonaState;
  visible: boolean;
}

export default function LiquidOrb({ state, visible }: LiquidOrbProps) {
  const uniforms = useOrbUniforms(state);

  const [dims, setDims] = useState({ w: 0, h: 0, size: 160 });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const size = w < 640 ? 130 : w < 1024 ? 160 : 190;
      setDims({ w, h: window.innerHeight, size });
    };

    update();
    window.addEventListener('resize', update);

    return () => window.removeEventListener('resize', update);
  }, []);

  const scale = dims.size / INTERNAL_SIZE;
  const cx = dims.w / 2;
  const cy = dims.h * 0.26;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 30,
        transform: `translate3d(${cx}px, ${cy}px, 0)`,
        opacity: visible ? 1 : 0,
        transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease',
      }}
    >
      <div
        className={state === 'thinking' ? 'orb-thinking' : state === 'speaking' ? 'orb-speaking' : undefined}
        style={{
          position: 'absolute',
          left: -INTERNAL_SIZE / 2,
          top: -INTERNAL_SIZE / 2,
          width: INTERNAL_SIZE,
          height: INTERNAL_SIZE,
          ['--orb-scale' as string]: scale,
          transform: `scale(${scale})`,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        <LiquidMetal
          shape="circle"
          colorBack={uniforms.colorBack}
          colorTint={uniforms.colorTint}
          distortion={uniforms.distortion}
          contour={uniforms.contour}
          repetition={uniforms.repetition}
          softness={uniforms.softness}
          shiftRed={uniforms.shiftRed}
          shiftBlue={uniforms.shiftBlue}
          angle={uniforms.angle}
          speed={uniforms.speed}
          scale={uniforms.scale}
          width={INTERNAL_SIZE}
          height={INTERNAL_SIZE}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
