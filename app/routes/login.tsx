import { redirect } from '@remix-run/cloudflare';

export async function loader() {
  return redirect('/');
}

export default function LoginRedirect() {
  return null;
}
