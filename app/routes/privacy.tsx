import type { MetaFunction } from '@remix-run/cloudflare';
import { LegalLayout, LegalSection } from '~/components/legal/LegalLayout';

export const meta: MetaFunction = () => [
  { title: 'Privacy Policy — Palmkit' },
  { name: 'description', content: 'How Palmkit handles your data.' },
];

export default function Privacy() {
  return (
    <LegalLayout title="Privacy Policy" updated="June 15, 2026">
      <p>
        This Privacy Policy explains what data Palmkit handles and how. We aim to collect as little as possible and to
        keep your work and credentials under your control.
      </p>

      <LegalSection heading="1. Data you provide">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-palmkit-elements-textPrimary">Account info (optional):</strong> if you sign in with
            GitHub, X, or email, we receive basic identity details (such as your name, email address, and avatar) to
            create your account.
          </li>
          <li>
            <strong className="text-palmkit-elements-textPrimary">API keys:</strong> the model provider key you enter.
            It is stored on your device, and — if you use an account — encrypted at rest so you don’t re-enter it each
            time. It is used only to make requests to your chosen provider on your behalf.
          </li>
          <li>
            <strong className="text-palmkit-elements-textPrimary">Projects &amp; chats:</strong> your prompts, generated
            files, and chat history, saved locally in your browser and — if signed in — to your account so you can
            resume your work.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. Third-party services">
        <p>When you use Palmkit, data flows to the services that make it work:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-palmkit-elements-textPrimary">Model providers (e.g. OpenRouter):</strong> your
            prompts and project context are sent to the AI model you select, using your API key, to generate responses.
          </li>
          <li>
            <strong className="text-palmkit-elements-textPrimary">Cloud sandbox (e.g. E2B):</strong> generated project
            files are sent to an ephemeral sandbox to install dependencies and produce a live preview, then destroyed.
          </li>
          <li>
            <strong className="text-palmkit-elements-textPrimary">Hosting (Cloudflare):</strong> serves the app and may
            process standard request metadata (e.g. IP address) for security and delivery.
          </li>
          <li>
            <strong className="text-palmkit-elements-textPrimary">Auth providers (GitHub / X):</strong> used only if you
            choose to sign in with them.
          </li>
        </ul>
        <p>Each third party processes data under its own privacy policy.</p>
      </LegalSection>

      <LegalSection heading="3. How we use data">
        <p>
          To provide and improve the Service: generate and preview your projects, restore your work, keep you signed in,
          and maintain security. We do not sell your data, and we do not use your prompts or projects to train models.
        </p>
      </LegalSection>

      <LegalSection heading="4. Storage, retention &amp; deletion">
        <p>
          Without an account, your work lives in your browser’s local storage and stays on your device. With an account,
          your projects and encrypted key are stored so you can access them across sessions and devices; you can delete
          a project at any time, and you may request deletion of your account and associated data.
        </p>
      </LegalSection>

      <LegalSection heading="5. Security">
        <p>
          API keys are encrypted at rest when stored with an account, and transmitted over HTTPS. No method of storage
          or transmission is perfectly secure, but we take reasonable measures to protect your data. Keep your own
          credentials safe and revoke any key you believe is exposed.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your rights">
        <p>
          You can access, export, or delete your projects, and request deletion of your account data. To exercise these
          rights, contact us.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          Questions about privacy? Contact us at <span style={{ color: '#f5f5f5' }}>support@palmkit.app</span>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
