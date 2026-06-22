import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

export const loader = async (_args: LoaderFunctionArgs) => {
  return json({ ok: true, message: 'test-simple works', ts: Date.now() });
};
