import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return cancelJobAction(args);
}

const logger = createScopedLogger('api.jobs.cancel');

/*
 * Cancel an in-flight build job (Supabase-native path).
 *
 * The front-end can't write 'cancel_requested' to build_jobs directly because
 * RLS requires the user's JWT (the anon key is read-blocked). This CF Pages
 * endpoint writes it using the authed user's Supabase client (which carries
 * their JWT), so RLS allows it.
 *
 * The orchestrator polls the job's status between agent steps; when it sees
 * 'cancel_requested' it fires its AbortController, writes a PARTIAL manifest,
 * and marks the job 'cancelled'. No public worker URL needed.
 */
async function cancelJobAction({ request, context }: ActionFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { jobId } = await request.json<{ jobId: string }>();

  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'jobId is required' }, { status: 400 });
  }

  /*
   * Verify the job belongs to this user before cancelling — prevents a user
   * from cancelling another user's job by guessing the ID. The PATCH's WHERE
   * clause also carries user_id as a belt-and-suspenders guard.
   */
  const { data: job, error: jobErr } = await authed.supabase
    .from('build_jobs')
    .select('id, user_id, status')
    .eq('id', jobId)
    .eq('user_id', authed.user.id)
    .single();

  if (jobErr || !job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  // Already terminal — nothing to cancel.
  if (job.status === 'ready_for_preview' || job.status === 'failed_clean' || job.status === 'cancelled') {
    return Response.json({ ok: true, reason: `already ${job.status}` });
  }

  const { error: updateErr } = await authed.supabase
    .from('build_jobs')
    .update({ status: 'cancel_requested' })
    .eq('id', jobId)
    .eq('user_id', authed.user.id);

  if (updateErr) {
    logger.error(`Failed to write cancel_requested for job ${jobId}:`, updateErr.message);

    return Response.json({ error: 'Failed to cancel job' }, { status: 500 });
  }

  logger.info(`Job ${jobId} cancel_requested by user ${authed.user.id}`);

  return Response.json({ ok: true });
}
