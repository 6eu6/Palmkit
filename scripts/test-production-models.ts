/**
 * Live Production Test — runs real HTTP requests against palmkit.app
 * with a logged-in session and tests the model classifier against
 * ACTUAL models returned by the API.
 *
 * Run: npx tsx scripts/test-production-models.ts
 *
 * Prerequisites:
 *   - Must have logged in via /api/auth/login first (cookies saved to /tmp/cookies.txt)
 *   - Must have at least one API key configured in the UI
 */

import { writeFileSync, readFileSync } from 'node:fs';

const BASE_URL = 'https://palmkit.app';
const COOKIES_PATH = '/tmp/cookies.txt';

// Read cookies
function getCookies(): string {
  try {
    const content = readFileSync(COOKIES_PATH, 'utf-8');
    const cookies: string[] = [];
    for (const line of content.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 7) {
        cookies.push(`${parts[5]}=${parts[6]}`);
      }
    }
    return cookies.join('; ');
  } catch {
    return '';
  }
}

// Inline the capability classifier (since we can't easily import from app/)
const IMAGE_GEN_PATTERNS = [
  /dall-?e/i, /stable-?diffusion/i, /sd[-_]?xl/i, /sd[-_]?3/i, /flux/i, /midjourney/i,
  /imagen/i, /cogview/i, /cog[-_]image/i, /kolors/i, /playground[-_]?v/i, /ideogram/i,
  /recraft/i, /leonardo/i, /firefly/i, /jasper/i, /dream[-_]?studio/i, /glif/i,
  /lumalabs/i, /lumia/i, /bfl[-_]?\.:/i, /black[-_]?forest/i,
];

const VIDEO_GEN_PATTERNS = [
  /sora/i, /runway/i, /pika/i, /cog[-_]?video/i, /kling/i, /luma[-_]?dream/i,
  /luma[-_]?ray/i, /stable[-_]?video/i, /svd/i, /animate[-_]?diff/i, /wan/i,
  /hailuo/i, /minimax[-_]?video/i, /veo/i,
];

const VISION_INPUT_PATTERNS = [
  /gpt-?4o/i, /gpt-?4[-_]?vision/i, /gpt-?4[-_]?turbo/i, /gpt-?4o[-_]?mini/i,
  /claude[-_]?3[-_]?5[-_]?sonnet/i, /claude[-_]?3[-_]?5[-_]?haiku/i, /claude[-_]?3[-_]?opus/i,
  /claude[-_]?3[-_]?sonnet/i, /claude[-_]?3[-_]?haiku/i, /claude[-_]?3[-_]?5/i,
  /gemini[-_]?1[-_.]?5/i, /gemini[-_]?2/i, /gemini[-_]?pro[-_]?vision/i, /gemini[-_]?ultra/i,
  /qwen[-_]?vl/i, /qwen[-_]?2[-_]?vl/i, /qwen[-_]?2[-_.]?5[-_]?vl/i, /internvl/i, /llava/i,
  /cogvlm/i, /cogagent/i, /glm[-_]?4v/i, /glm[-_]?4[-_]?v/i, /pixtral/i,
  /phi[-_]?3[-_]?vision/i, /phi[-_]?3[-_.]?5[-_]?vision/i, /moondream/i, /idefics/i,
  /florence/i, /kosmos/i, /mistral[-_]?pixtral/i,
];

const REASONING_PATTERNS = [
  /\bo1\b/i, /\bo3\b/i, /\bo4\b/i, /openai[-_]?o1/i, /openai[-_]?o3/i, /openai[-_]?o4/i,
  /gpt-?5/i, /reasoning/i, /r1\b/i, /deepseek[-_]?r1/i, /deepseek[-_]?reason/i,
  /qwen[-_]?qwq/i, /qwq/i, /qwen[-_]?2[-_.]?5[-_]?max/i, /claude[-_]?thinking/i,
  /gemini[-_]?2[-_.]?0[-_]?flash[-_]?thinking/i, /gemini[-_]?thinking/i,
  /glm[-_]?zero/i, /glm[-_]?5/i, /glm-?5\.?\d/i, /o3[-_]?mini/i, /o1[-_]?mini/i,
];

const CODE_PATTERNS = [
  /code[-_]?llama/i, /codellama/i, /deepseek[-_]?coder/i, /deepseek[-_]?code/i,
  /qwen[-_]?2[-_.]?5[-_]?coder/i, /qwen[-_]?coder/i, /codestral/i, /codeqwen/i,
  /starcoder/i, /codegemma/i, /phind/i, /wizard[-_]?coder/i, /wizard[-_]?code/i,
  /magicoder/i, /openchat/i, /olmo[-_]?code/i, /code[-_]?t5/i, /codegen/i,
  /polycoder/i, /refact/i, /glm[-_]?4[-_]?5/i, /glm[-_]?4\.5/i, /glm[-_]?4\.6/i,
  /claude[-_]?sonnet/i, /claude[-_]?3[-_]?5[-_]?sonnet/i, /gpt-?5/i,
];

function classifyModel(name: string): { image: boolean; video: boolean; vision: boolean; reasoning: boolean; code: boolean; text: boolean } {
  const stripped = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  const caps = { image: false, video: false, vision: false, reasoning: false, code: false, text: false };

  if (IMAGE_GEN_PATTERNS.some((re) => re.test(stripped))) caps.image = true;
  if (VIDEO_GEN_PATTERNS.some((re) => re.test(stripped))) caps.video = true;
  if (VISION_INPUT_PATTERNS.some((re) => re.test(stripped))) { caps.vision = true; caps.text = true; }
  if (REASONING_PATTERNS.some((re) => re.test(stripped))) { caps.reasoning = true; caps.text = true; }
  if (CODE_PATTERNS.some((re) => re.test(stripped))) { caps.code = true; caps.text = true; }
  if (!caps.image && !caps.video && !caps.vision && !caps.reasoning && !caps.code) caps.text = true;
  if (caps.image && !caps.vision && !caps.reasoning && !caps.code) caps.text = false;
  if (caps.video && !caps.vision && !caps.reasoning && !caps.code) caps.text = false;

  return caps;
}

async function main() {
  console.log('=== Live Production Model Classifier Test ===\n');

  const cookies = getCookies();
  if (!cookies) {
    console.error('No cookies found. Login first.');
    process.exit(1);
  }

  // Fetch all models from the production API
  console.log('Fetching models from /api/models...');
  const res = await fetch(`${BASE_URL}/api/models`, {
    headers: { Cookie: cookies },
  });

  if (!res.ok) {
    console.error(`Failed to fetch models: HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json() as { models?: Array<{ name: string; provider: string; label?: string }> };
  const models = data.models || [];

  console.log(`Total models available: ${models.length}\n`);

  if (models.length === 0) {
    console.log('No models returned. The user has no API keys configured in the UI.');
    console.log('To test with real models, configure an API key at https://palmkit.app');
    process.exit(0);
  }

  // Classify all models
  const classified = models.map((m) => ({
    name: m.name,
    provider: m.provider,
    label: m.label || m.name,
    capabilities: classifyModel(m.name),
  }));

  // Group by capability
  const groups = {
    image: classified.filter((m) => m.capabilities.image),
    video: classified.filter((m) => m.capabilities.video),
    vision: classified.filter((m) => m.capabilities.vision),
    reasoning: classified.filter((m) => m.capabilities.reasoning),
    code: classified.filter((m) => m.capabilities.code),
    text: classified.filter((m) => m.capabilities.text),
  };

  // Print summary
  console.log('=== Capability Distribution ===');
  for (const [cap, list] of Object.entries(groups)) {
    console.log(`\n${cap.toUpperCase()} (${list.length} models):`);
    for (const m of list.slice(0, 10)) {
      console.log(`  - ${m.name} [${m.provider}]`);
    }
    if (list.length > 10) {
      console.log(`  ... and ${list.length - 10} more`);
    }
  }

  // Test role assignments
  console.log('\n\n=== Role Assignment Test ===');
  const roles = {
    brain: { primary: 'reasoning', fallback: 'text', models: classified.filter((m) => m.capabilities.reasoning || m.capabilities.text) },
    builder: { primary: 'code', fallback: 'text', models: classified.filter((m) => m.capabilities.code || m.capabilities.text) },
    tester: { primary: 'code', fallback: 'text', models: classified.filter((m) => m.capabilities.code || m.capabilities.text) },
    vision: { primary: 'vision', fallback: 'text', models: classified.filter((m) => m.capabilities.vision || m.capabilities.text) },
    media: { primary: 'image', fallback: 'video', models: classified.filter((m) => m.capabilities.image || m.capabilities.video) },
  };

  for (const [role, info] of Object.entries(roles)) {
    console.log(`\n${role} (${info.models.length} compatible models, primary=${info.primary}):`);
    for (const m of info.models.slice(0, 5)) {
      console.log(`  - ${m.name} [${m.provider}]`);
    }
    if (info.models.length === 0) {
      console.log('  ⚠️ No compatible models — the dropdown will show "No compatible models"');
    }
  }

  // Save full report
  const report = {
    timestamp: new Date().toISOString(),
    totalModels: models.length,
    distribution: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    roleAssignments: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.models.length])),
    classifiedModels: classified,
  };

  writeFileSync('/home/z/my-project/download/production-model-classification.json', JSON.stringify(report, null, 2));
  console.log('\n\n=== Full report saved to /home/z/my-project/download/production-model-classification.json ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
