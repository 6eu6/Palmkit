import { describe, it, expect } from 'vitest';
import { mergeFragments, blendedCost, type DescriptorFragment } from './model-descriptor';
import { catalogLookup } from './sources/catalog';
import { effortProviderOptions, effortAvailable } from './effort';

/**
 * The merge is the heart of the registry: a strong source must win a field it
 * knows, and must NOT erase a field it says nothing about.
 */
describe('mergeFragments', () => {
  const heuristic: DescriptorFragment = {
    input: { text: true, image: false },
    output: { text: true },
    source: 'heuristic',
  };

  it('lets a stronger source overwrite a weaker one', () => {
    const provider: DescriptorFragment = { input: { image: true }, source: 'provider-api' };
    const d = mergeFragments('X', 'm', [heuristic, provider]);

    expect(d.input.image).toBe(true);
    expect(d.source).toBe('provider-api');
    expect(d.confidence).toBe(1);
  });

  it('does not let a weaker source overwrite a stronger one', () => {
    const provider: DescriptorFragment = { input: { image: true }, source: 'provider-api' };

    // Order in the array must not matter — rank decides.
    const d = mergeFragments('X', 'm', [provider, heuristic]);

    expect(d.input.image).toBe(true);
  });

  it('fills a gap the stronger source left empty', () => {
    const provider: DescriptorFragment = { input: { image: true }, source: 'provider-api' };
    const catalog: DescriptorFragment = { cost: { promptPerM: 3 }, source: 'catalog' };
    const d = mergeFragments('X', 'm', [catalog, provider]);

    // The provider said nothing about price, so the catalog's survives.
    expect(d.cost.promptPerM).toBe(3);
    expect(d.input.image).toBe(true);
  });

  it('reports the strongest contributing source, not the last one', () => {
    const probe: DescriptorFragment = { tools: { functionCalling: true }, source: 'probe' };
    const d = mergeFragments('X', 'm', [probe, heuristic]);

    expect(d.source).toBe('probe');
    expect(d.tools.functionCalling).toBe(true);
  });

  it('defaults to knowing nothing rather than to false confidence', () => {
    const d = mergeFragments('X', 'm', []);

    expect(d.confidence).toBe(0);
    expect(d.output.video).toBe(false);
  });
});

describe('catalogLookup', () => {
  it('matches a dated snapshot to its family', () => {
    const d = catalogLookup('gpt-4o-2024-11-20');

    expect(d?.source).toBe('catalog');
    expect(d?.input?.image).toBe(true);
  });

  it('prefers the longest matching prefix', () => {
    // `gpt-4o-mini` must not resolve to the pricier `gpt-4o` entry.
    expect(catalogLookup('gpt-4o-mini')?.cost?.promptPerM).toBe(0.15);
    expect(catalogLookup('gpt-4o')?.cost?.promptPerM).toBe(2.5);
  });

  it('strips a provider prefix before matching', () => {
    expect(catalogLookup('anthropic/claude-opus-4-1')?.cost?.promptPerM).toBe(15);
  });

  it('separates "reasons" from "reasoning can be asked for"', () => {
    const r = catalogLookup('deepseek-reasoner');

    expect(r?.reasoning?.supported).toBe(true);
    expect(r?.reasoning?.controllable).toBe(false);
  });

  it('identifies models by OUTPUT modality, not by name', () => {
    expect(catalogLookup('veo-3')?.output?.video).toBe(true);
    expect(catalogLookup('dall-e-3')?.output?.image).toBe(true);
    expect(catalogLookup('dall-e-3')?.output?.text).toBe(false);
  });

  it('returns nothing for a model it has never heard of', () => {
    expect(catalogLookup('totally-made-up-model-9000')).toBeUndefined();
  });
});

describe('effort', () => {
  const steerable = mergeFragments('OpenAI', 'o3', [
    { reasoning: { supported: true, controllable: true }, source: 'catalog' },
  ]);
  const fixed = mergeFragments('Deepseek', 'deepseek-reasoner', [
    { reasoning: { supported: true, controllable: false }, source: 'catalog' },
  ]);

  it('sends nothing at all on Balanced', () => {
    expect(effortProviderOptions('OpenAI', steerable, 'balanced')).toBeUndefined();
  });

  it('sends nothing on a model that cannot be steered', () => {
    expect(effortProviderOptions('Deepseek', fixed, 'deep')).toBeUndefined();
    expect(effortAvailable('Deepseek', fixed)).toBe(false);
  });

  it('speaks each provider its own dialect', () => {
    expect(effortProviderOptions('OpenAI', steerable, 'deep')).toEqual({ openai: { reasoningEffort: 'high' } });
    expect(effortProviderOptions('Anthropic', steerable, 'fast')).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } },
    });
    expect(effortProviderOptions('Google', steerable, 'deep')).toEqual({
      google: { thinkingConfig: { thinkingBudget: 24_000 } },
    });
    expect(effortProviderOptions('OpenRouter', steerable, 'fast')).toEqual({
      openrouter: { reasoning: { effort: 'low' } },
    });
  });

  it('sends nothing to a provider with no effort dialect', () => {
    expect(effortProviderOptions('Ollama', steerable, 'deep')).toBeUndefined();
  });
});

describe('blendedCost', () => {
  it('weights prompt tokens above completion, as a turn does', () => {
    const cheap = mergeFragments('X', 'a', [{ cost: { promptPerM: 1, completionPerM: 1 }, source: 'catalog' }]);
    const dear = mergeFragments('X', 'b', [{ cost: { promptPerM: 10, completionPerM: 10 }, source: 'catalog' }]);

    expect(blendedCost(cheap)).toBeLessThan(blendedCost(dear));
  });

  it('treats an unpriced model as zero rather than as free-and-best', () => {
    const unknown = mergeFragments('X', 'c', [{ source: 'heuristic' }]);

    expect(blendedCost(unknown)).toBe(0);
  });
});
