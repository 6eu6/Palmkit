import { describe, expect, it } from 'vitest';
import { candidatesFor, chooseModel } from '~/lib/.server/llm/model-router';
import { emptyDescriptor, type ModelDescriptor } from '~/lib/modules/llm/model-descriptor';

/**
 * Routing decisions, against the shapes OpenRouter actually returns.
 *
 * The fixtures below are not invented: the prices and modalities are what
 * `GET /models` reported for these models, including `openrouter/auto`
 * pricing at -1 per token, which is the case that made cheapest-first pick
 * a meta-router instead of a model that can draw.
 */

function model(
  name: string,
  patch: {
    image?: boolean;
    video?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    completionPerM?: number;
    source?: ModelDescriptor['source'];
  },
): ModelDescriptor {
  const d = emptyDescriptor('OpenRouter', name);
  d.output.text = true;
  d.output.image = patch.image ?? false;
  d.output.video = patch.video ?? false;
  d.input.image = patch.vision ?? false;
  d.reasoning.supported = patch.reasoning ?? false;
  d.cost.completionPerM = patch.completionPerM;
  d.source = patch.source ?? 'provider-api';

  return d;
}

function catalog(...models: ModelDescriptor[]): Map<string, ModelDescriptor> {
  return new Map(models.map((d) => [`${d.provider}::${d.model}`, d]));
}

describe('chooseModel', () => {
  it('picks the cheapest model that can actually do the job', () => {
    const c = catalog(
      model('google/gemini-3.1-flash-lite-image', { image: true, completionPerM: 1.5 }),
      model('openai/gpt-5-image', { image: true, completionPerM: 10 }),
      model('z-ai/glm-4.7', { completionPerM: 1.75 }),
    );

    const route = chooseModel(c, { capability: 'image' });

    expect(route?.model).toBe('google/gemini-3.1-flash-lite-image');
    expect(route?.reason).toContain('1.5');
  });

  /*
   * The bug this file exists for. `openrouter/auto` reports pricing of -1,
   * meaning "depends what it routes to". Read as a number it is the cheapest
   * thing in the catalog by a factor of a million.
   */
  it('does not treat a negative price as cheap', () => {
    const c = catalog(
      model('openrouter/auto', { image: true, completionPerM: -1_000_000 }),
      model('google/gemini-3.1-flash-lite-image', { image: true, completionPerM: 1.5 }),
    );

    expect(chooseModel(c, { capability: 'image' })?.model).toBe('google/gemini-3.1-flash-lite-image');
  });

  it('prefers an established fact over a cheap guess', () => {
    const c = catalog(
      model('mystery/cheap-guess', { image: true, completionPerM: 0.1, source: 'heuristic' }),
      model('google/known-image', { image: true, completionPerM: 9, source: 'provider-api' }),
    );

    expect(chooseModel(c, { capability: 'image' })?.model).toBe('google/known-image');
  });

  it('honours an explicit choice over the cheapest', () => {
    const c = catalog(
      model('cheap/image', { image: true, completionPerM: 1 }),
      model('fancy/image', { image: true, completionPerM: 40 }),
    );

    const route = chooseModel(c, { capability: 'image', preferred: 'fancy/image' });

    expect(route?.model).toBe('fancy/image');
    expect(route?.reason).toBe('chosen in settings');
  });

  it('ignores an explicit choice that cannot do the job', () => {
    const c = catalog(
      model('cheap/image', { image: true, completionPerM: 1 }),
      model('text/only', { completionPerM: 0.1 }),
    );

    // Asking for a text model to draw must not override the capability check.
    expect(chooseModel(c, { capability: 'image', preferred: 'text/only' })?.model).toBe('cheap/image');
  });

  it('returns nothing rather than a model that cannot do it', () => {
    const c = catalog(model('z-ai/glm-4.7', { completionPerM: 1.75 }));

    expect(chooseModel(c, { capability: 'image' })).toBeUndefined();
    expect(chooseModel(c, { capability: 'video' })).toBeUndefined();
  });

  it('stays within the provider whose key the user has', () => {
    const mine = model('google/gemini-image', { image: true, completionPerM: 5 });
    const theirs = model('other/cheaper-image', { image: true, completionPerM: 1 });
    theirs.provider = 'Anthropic';

    const route = chooseModel(catalog(mine, theirs), { capability: 'image', provider: 'OpenRouter' });

    expect(route?.model).toBe('google/gemini-image');
  });

  it('separates the capabilities it routes on', () => {
    const c = catalog(
      model('draws', { image: true, completionPerM: 5 }),
      model('films', { video: true, completionPerM: 5 }),
      model('sees', { vision: true, completionPerM: 5 }),
      model('thinks', { reasoning: true, completionPerM: 5 }),
    );

    expect(chooseModel(c, { capability: 'image' })?.model).toBe('draws');
    expect(chooseModel(c, { capability: 'video' })?.model).toBe('films');
    expect(chooseModel(c, { capability: 'vision' })?.model).toBe('sees');
    expect(chooseModel(c, { capability: 'reasoning' })?.model).toBe('thinks');
  });
});

describe('candidatesFor', () => {
  it('lists every capable model, cheapest first', () => {
    const c = catalog(
      model('b', { image: true, completionPerM: 10 }),
      model('a', { image: true, completionPerM: 2 }),
      model('not-an-image-model', { completionPerM: 1 }),
    );

    expect(candidatesFor(c, 'image').map((d) => d.model)).toEqual(['a', 'b']);
  });

  it('puts unpriced models last, not first', () => {
    const c = catalog(model('priced', { image: true, completionPerM: 8 }), model('unpriced', { image: true }));

    expect(candidatesFor(c, 'image').map((d) => d.model)).toEqual(['priced', 'unpriced']);
  });
});
