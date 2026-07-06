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
   * Write status='cancelled' + error_summary='Cancelled by user' directly.
   * (We can't use a 'cancel_requested' status — the DB has a CHECK constraint
   * on the status column that only allows the original 5 values. 'cancelled'
   * IS in the allowed set, so we reuse it. The orchestrator checks for
   * status='cancelled' + error_summary='Cancelled by user' to distinguish a
   * user-initiated cancel from a system failure.)
   *
   * The WHERE clause (id + user_id + status-in-[pending,generating]) is the
   * security guard — RLS + user_id match ensures a user can only cancel their
   * own jobs, and the status filter prevents cancelling an already-terminal
   * job.
   */
  const { data: updated, error: updateErr } = await authed.supabase
    .from('build_jobs')
    .update({ status: 'cancelled', error_summary: 'Cancelled by user' })
    .eq('id', jobId)
    .eq('user_id', authed.user.id)
    .in('status', ['pending', 'generating'])
    .select('id, status')
    .maybeSingle();

  if (updateErr) {
    logger.error(`Failed to write cancel_requested for job ${jobId}:`, updateErr.message);

    return Response.json({ error: 'Failed to cancel job', detail: updateErr.message }, { status: 500 });
  }

  if (!updated) {
    /*
     * Either the job doesn't exist, belongs to another user, or is already
     * terminal (ready_for_preview / failed_clean / cancelled). All three are
     * safe to report as "already done" — the caller proceeds either way.
     */
    return Response.json({ ok: true, reason: 'already terminal or not found' });
  }

  logger.info(`Job ${jobId} cancel_requested by user ${authed.user.id}`);

  return Response.json({ ok: true });
}
