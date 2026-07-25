/**
 * Capability Classifier — unit tests
 *
 * Tests cover:
 *   - Image generation detection (dall-e, stable-diffusion, flux, etc.)
 *   - Video generation detection (sora, runway, kling, etc.)
 *   - Vision (multimodal input) detection (gpt-4o, claude-3-5, gemini, etc.)
 *   - Reasoning detection (o1, o3, R1, QwQ, etc.)
 *   - Code detection (deepseek-coder, qwen-coder, codestral, etc.)
 *   - General text fallback
 *   - Provider prefix stripping (~anthropic/, openai/, etc.)
 *   - filterModelsByCapability for each role spec
 */

import { describe, it, expect } from 'vitest';
import {
  classifyModelCapabilities,
  modelSupports,
  getModelCapabilityLabel,
  getModelCapabilityIcon,
  filterModelsByCapability,
} from './capabilities';
import { ROLE_CAPABILITY_SPEC } from '~/lib/stores/model-roles';

describe('classifyModelCapabilities — reasoning disqualify patterns', () => {
  it('does NOT classify gpt-5-image as reasoning (it is image)', () => {
    const caps = classifyModelCapabilities('gpt-5-image');
    expect(caps.reasoning).toBe(false);
    expect(caps.image).toBe(true);
  });

  it('does NOT classify gpt-5-codex as reasoning (it is code)', () => {
    const caps = classifyModelCapabilities('gpt-5-codex');
    expect(caps.reasoning).toBe(false);
    expect(caps.code).toBe(true);
  });

  it('does NOT classify gpt-5-mini as reasoning', () => {
    const caps = classifyModelCapabilities('gpt-5-mini');
    expect(caps.reasoning).toBe(false);
  });

  it('does NOT classify gpt-5-nano as reasoning', () => {
    const caps = classifyModelCapabilities('gpt-5-nano');
    expect(caps.reasoning).toBe(false);
  });

  it('does NOT classify gpt-5-chat as reasoning', () => {
    const caps = classifyModelCapabilities('gpt-5-chat');
    expect(caps.reasoning).toBe(false);
  });

  it('does NOT classify glm-5v as reasoning (it is vision)', () => {
    const caps = classifyModelCapabilities('glm-5v');
    expect(caps.reasoning).toBe(false);
    expect(caps.vision).toBe(true);
  });

  it('classifies gpt-5 (base) as reasoning', () => {
    const caps = classifyModelCapabilities('gpt-5');
    expect(caps.reasoning).toBe(true);
  });

  it('classifies gpt-5.2 as reasoning', () => {
    const caps = classifyModelCapabilities('gpt-5.2');
    expect(caps.reasoning).toBe(true);
  });

  it('classifies glm-5.2 as reasoning', () => {
    const caps = classifyModelCapabilities('glm-5.2');
    expect(caps.reasoning).toBe(true);
  });
});

describe('classifyModelCapabilities — image generation', () => {
  const imageModels = [
    'dall-e-3',
    'dalle-3',
    'stable-diffusion-xl',
    'sdxl',
    'sd-3.5',
    'flux-pro',
    'flux-dev',
    'imagen-3',
    'cogview-3',
    'kolors',
    'ideogram-v2',
    'recraft-v3',
    'midjourney-v6',
    'playground-v2.5',
  ];

  for (const name of imageModels) {
    it(`detects ${name} as image-capable`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.image).toBe(true);
      expect(caps.text).toBe(false); // pure image models don't do text
    });
  }
});

describe('classifyModelCapabilities — video generation', () => {
  const videoModels = [
    'sora',
    'sora-2',
    'runway-gen-3',
    'pika-v1',
    'cogvideox',
    'kling-v1',
    'luma-dream-machine',
    'stable-video-diffusion',
    'svd-xt',
    'wan-2.1',
    'veo-2',
  ];

  for (const name of videoModels) {
    it(`detects ${name} as video-capable`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.video).toBe(true);
    });
  }
});

describe('classifyModelCapabilities — vision (multimodal input)', () => {
  const visionModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-vision',
    'claude-3-5-sonnet',
    'claude-3-5-haiku',
    'claude-3-opus',
    'claude-3-sonnet',
    'gemini-1.5-pro',
    'gemini-2.0-flash',
    'qwen-vl-max',
    'qwen-2-vl-72b',
    'qwen-2.5-vl-72b',
    'llava-1.5',
    'internvl-2',
    'glm-4v',
    'pixtral-12b',
    'phi-3-vision',
    'moondream2',
  ];

  for (const name of visionModels) {
    it(`detects ${name} as vision-capable`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.vision).toBe(true);
      expect(caps.text).toBe(true); // vision models also do text
    });
  }
});

describe('classifyModelCapabilities — reasoning', () => {
  const reasoningModels = [
    'o1',
    'o1-mini',
    'o1-pro',
    'o3',
    'o3-mini',
    'o4-mini',
    'openai-o1',
    'gpt-5',
    'deepseek-r1',
    'qwen-qwq-32b',
    'qwq-32b',
    'glm-zero',
    'glm-5',
    'glm-5.2',
    'gemini-2.0-flash-thinking',
  ];

  for (const name of reasoningModels) {
    it(`detects ${name} as reasoning-capable`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.reasoning).toBe(true);
    });
  }
});

describe('classifyModelCapabilities — code-optimized', () => {
  const codeModels = [
    'deepseek-coder-v2',
    'deepseek-coder-33b',
    'qwen-2.5-coder-32b',
    'qwen-coder-7b',
    'codellama-70b',
    'code-llama-13b',
    'codestral-22b',
    'codeqwen-25',
    'starcoder-2',
    'codegemma-7b',
    'wizard-coder-33b',
    'refact-1.6b',
  ];

  for (const name of codeModels) {
    it(`detects ${name} as code-capable`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.code).toBe(true);
      expect(caps.text).toBe(true);
    });
  }
});

describe('classifyModelCapabilities — general text fallback', () => {
  const textModels = [
    'gpt-3.5-turbo',
    'gpt-4',
    'llama-3.1-70b',
    'mistral-7b',
    'gemini-1.0-pro',
    'command-r',
    'yi-34b',
    'phi-3-mini',
  ];

  for (const name of textModels) {
    it(`detects ${name} as text-capable (general fallback)`, () => {
      const caps = classifyModelCapabilities(name);
      expect(caps.text).toBe(true);

      // Should not be classified as image/video
      expect(caps.image).toBe(false);
      expect(caps.video).toBe(false);
    });
  }
});

describe('classifyModelCapabilities — provider prefix stripping', () => {
  it('strips ~anthropic/ prefix', () => {
    const caps = classifyModelCapabilities('~anthropic/claude-3-5-sonnet');
    expect(caps.vision).toBe(true);
  });

  it('strips openai/ prefix', () => {
    const caps = classifyModelCapabilities('openai/gpt-4o');
    expect(caps.vision).toBe(true);
  });

  it('strips z-ai/ prefix', () => {
    const caps = classifyModelCapabilities('z-ai/glm-5.2');
    expect(caps.reasoning).toBe(true);
  });

  it('handles model without prefix', () => {
    const caps = classifyModelCapabilities('gpt-4o');
    expect(caps.vision).toBe(true);
  });
});

describe('modelSupports', () => {
  it('returns true for supported capability', () => {
    expect(modelSupports('dall-e-3', 'image')).toBe(true);
    expect(modelSupports('gpt-4o', 'vision')).toBe(true);
    expect(modelSupports('o1', 'reasoning')).toBe(true);
  });

  it('returns false for unsupported capability', () => {
    expect(modelSupports('dall-e-3', 'vision')).toBe(false);
    expect(modelSupports('dall-e-3', 'text')).toBe(false);
    expect(modelSupports('gpt-3.5-turbo', 'image')).toBe(false);
  });
});

describe('getModelCapabilityLabel', () => {
  it('returns "image" for image models', () => {
    expect(getModelCapabilityLabel('dall-e-3')).toBe('image');
    expect(getModelCapabilityLabel('flux-pro')).toBe('image');
  });

  it('returns "video" for video models', () => {
    expect(getModelCapabilityLabel('sora')).toBe('video');
  });

  it('returns "reasoning" for reasoning models', () => {
    expect(getModelCapabilityLabel('o1')).toBe('reasoning');
    expect(getModelCapabilityLabel('glm-5.2')).toBe('reasoning');
  });

  it('returns "code" for code models', () => {
    expect(getModelCapabilityLabel('deepseek-coder-v2')).toBe('code');
  });

  it('returns "vision" for vision models (without reasoning/code)', () => {
    expect(getModelCapabilityLabel('llava-1.5')).toBe('vision');
  });

  it('returns "text" for general models', () => {
    expect(getModelCapabilityLabel('gpt-3.5-turbo')).toBe('text');
    expect(getModelCapabilityLabel('llama-3.1-70b')).toBe('text');
  });
});

describe('getModelCapabilityIcon', () => {
  it('returns Phosphor icon for each capability', () => {
    expect(getModelCapabilityIcon('dall-e-3')).toBe('ph:image-duotone');
    expect(getModelCapabilityIcon('sora')).toBe('ph:video-camera-duotone');
    expect(getModelCapabilityIcon('o1')).toBe('ph:brain-duotone');
    expect(getModelCapabilityIcon('deepseek-coder-v2')).toBe('ph:code-duotone');
    expect(getModelCapabilityIcon('llava-1.5')).toBe('ph:eye-duotone');
    expect(getModelCapabilityIcon('gpt-3.5-turbo')).toBe('ph:chat-circle-text-duotone');
  });
});

describe('filterModelsByCapability — role specs (shows ALL models, no hiding)', () => {
  // Sample model list (mix of all capabilities)
  const sampleModels = [
    { name: 'gpt-4o', label: 'GPT-4o' },
    { name: 'o1', label: 'o1' },
    { name: 'glm-5.2', label: 'GLM-5.2' },
    { name: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    { name: 'deepseek-coder-v2', label: 'DeepSeek Coder V2' },
    { name: 'qwen-2.5-coder-32b', label: 'Qwen 2.5 Coder' },
    { name: 'dall-e-3', label: 'DALL-E 3' },
    { name: 'flux-pro', label: 'FLUX Pro' },
    { name: 'sora', label: 'Sora' },
    { name: 'llava-1.5', label: 'LLaVA' },
    { name: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { name: 'llama-3.1-70b', label: 'Llama 3.1 70B' },
  ];

  it('brain role: reasoning in recommended, others NOT hidden', () => {
    const spec = ROLE_CAPABILITY_SPEC.brain;
    const result = filterModelsByCapability(sampleModels, spec);

    // Recommended: o1, glm-5.2 (reasoning)
    expect(result.recommended.some((m) => m.name === 'o1')).toBe(true);
    expect(result.recommended.some((m) => m.name === 'glm-5.2')).toBe(true);

    // ALL models appear in the full list (no hiding)
    expect(result.all.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.all.some((m) => m.name === 'sora')).toBe(true);
    expect(result.all.some((m) => m.name === 'gpt-3.5-turbo')).toBe(true);
    expect(result.all.some((m) => m.name === 'llama-3.1-70b')).toBe(true);

    // Image models go to "others" (not recommended, not compatible)
    expect(result.others.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.others.some((m) => m.name === 'sora')).toBe(true);
  });

  it('builder role: code in recommended, reasoning in compatible, others visible', () => {
    const spec = ROLE_CAPABILITY_SPEC.builder;
    const result = filterModelsByCapability(sampleModels, spec);

    // Recommended: deepseek-coder-v2, qwen-2.5-coder (code)
    expect(result.recommended.some((m) => m.name === 'deepseek-coder-v2')).toBe(true);
    expect(result.recommended.some((m) => m.name === 'qwen-2.5-coder-32b')).toBe(true);

    // Reasoning in compatible (secondary: reasoning)
    expect(result.compatible.some((m) => m.name === 'o1')).toBe(true);

    // Image models in others (NOT hidden)
    expect(result.all.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.others.some((m) => m.name === 'dall-e-3')).toBe(true);
  });

  it('vision role: vision in recommended, others NOT hidden', () => {
    const spec = ROLE_CAPABILITY_SPEC.vision;
    const result = filterModelsByCapability(sampleModels, spec);

    // Recommended: gpt-4o, claude-3-5-sonnet, llava (vision)
    expect(result.recommended.some((m) => m.name === 'gpt-4o')).toBe(true);
    expect(result.recommended.some((m) => m.name === 'claude-3-5-sonnet')).toBe(true);
    expect(result.recommended.some((m) => m.name === 'llava-1.5')).toBe(true);

    // Image-gen models in others (NOT hidden)
    expect(result.all.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.others.some((m) => m.name === 'dall-e-3')).toBe(true);
  });

  it('media role: image/video in recommended, ALL others still visible', () => {
    const spec = ROLE_CAPABILITY_SPEC.media;
    const result = filterModelsByCapability(sampleModels, spec);

    // Recommended: dall-e-3, flux-pro (image)
    expect(result.recommended.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.recommended.some((m) => m.name === 'flux-pro')).toBe(true);

    // Compatible: sora (video, secondary)
    expect(result.compatible.some((m) => m.name === 'sora')).toBe(true);

    // Text models in others (NOT hidden — user can still pick)
    expect(result.all.some((m) => m.name === 'gpt-3.5-turbo')).toBe(true);
    expect(result.all.some((m) => m.name === 'llama-3.1-70b')).toBe(true);
    expect(result.all.some((m) => m.name === 'gpt-4o')).toBe(true);

    // They go to "others"
    expect(result.others.some((m) => m.name === 'gpt-3.5-turbo')).toBe(true);
    expect(result.others.some((m) => m.name === 'gpt-4o')).toBe(true);
  });

  it('tester role: code in recommended, reasoning in compatible, others visible', () => {
    const spec = ROLE_CAPABILITY_SPEC.tester;
    const result = filterModelsByCapability(sampleModels, spec);

    expect(result.recommended.some((m) => m.name === 'deepseek-coder-v2')).toBe(true);
    expect(result.compatible.some((m) => m.name === 'o1')).toBe(true);

    // Image models in others (NOT hidden)
    expect(result.all.some((m) => m.name === 'dall-e-3')).toBe(true);
    expect(result.others.some((m) => m.name === 'dall-e-3')).toBe(true);
  });

  it('all models are preserved in the "all" list (no hiding)', () => {
    const spec = ROLE_CAPABILITY_SPEC.brain;
    const result = filterModelsByCapability(sampleModels, spec);

    // Every input model appears in result.all
    expect(result.all).toHaveLength(sampleModels.length);

    for (const m of sampleModels) {
      expect(result.all.some((r) => r.name === m.name)).toBe(true);
    }
  });
});

describe('filterModelsByCapability — edge cases', () => {
  it('handles empty model list', () => {
    const result = filterModelsByCapability([], ROLE_CAPABILITY_SPEC.brain);
    expect(result.recommended).toEqual([]);
    expect(result.compatible).toEqual([]);
    expect(result.all).toEqual([]);
  });

  it('deduplicates models with same name', () => {
    const models = [
      { name: 'o1', label: 'o1' },
      { name: 'o1', label: 'o1 duplicate' },
    ];
    const result = filterModelsByCapability(models, ROLE_CAPABILITY_SPEC.brain);
    expect(result.recommended).toHaveLength(1);
  });

  it('handles model with provider prefix', () => {
    const models = [{ name: '~anthropic/claude-3-5-sonnet', label: 'Claude 3.5' }];
    const result = filterModelsByCapability(models, ROLE_CAPABILITY_SPEC.vision);
    expect(result.recommended).toHaveLength(1);
  });
});
