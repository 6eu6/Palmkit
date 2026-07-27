import type { MetaFunction } from '@remix-run/cloudflare';
import { LegalLayout, LegalSection } from '~/components/legal/LegalLayout';

export const meta: MetaFunction = () => [
  { title: 'Terms of Service — Palmkit' },
  { name: 'description', content: 'The terms that govern your use of Palmkit.' },
];

export default function Terms() {
  return (
    <LegalLayout title="Terms of Service" updated="June 15, 2026">
      <p>
        Welcome to Palmkit. By accessing or using Palmkit (the “Service”), you agree to these Terms of Service. If you
        do not agree, please do not use the Service.
      </p>

      <LegalSection heading="1. What Palmkit is">
        <p>
          Palmkit is a mobile-first, browser-based AI development workspace. It lets you describe a web project in
          natural language, generate and edit its code, preview it live, and export it. The Service is provided on an
          “as is” basis and is under active development.
        </p>
      </LegalSection>

      <LegalSection heading="2. Bring Your Own Key (BYOK)">
        <p>
          Palmkit uses AI models through third-party providers (for example OpenRouter). You supply your own API key.
          Any usage, costs, rate limits, and billing for those models are governed by your agreement with that provider
          — not by Palmkit. You are responsible for keeping your key secure and for all activity performed with it.
        </p>
      </LegalSection>

      <LegalSection heading="3. Code execution and previews">
        <p>
          Generated projects may run inside ephemeral cloud sandboxes (for example E2B) or an in-browser runtime, solely
          to install dependencies and produce a live preview. Sandboxes are temporary and are automatically destroyed
          after a period of inactivity. Do not rely on a sandbox for storage or for running production workloads.
        </p>
      </LegalSection>

      <LegalSection heading="4. Your content and acceptable use">
        <p>
          You retain ownership of the prompts you write and the projects you generate. You are solely responsible for
          the code you create and how you use it. You agree not to use the Service to generate or run anything unlawful,
          harmful, infringing, or abusive, and not to attempt to disrupt or misuse the infrastructure.
        </p>
      </LegalSection>

      <LegalSection heading="5. AI output">
        <p>
          AI-generated code and content may be inaccurate, insecure, or incomplete. Always review, test, and secure any
          output before using it. Palmkit does not guarantee the correctness, security, or fitness of generated output
          for any purpose.
        </p>
      </LegalSection>

      <LegalSection heading="6. Intellectual property">
        <p>
          Palmkit is an independent project built on top of the MIT-licensed palmkit.app codebase; the original license
          and attributions are preserved. The Palmkit name and branding belong to its maintainer. Your generated
          projects remain yours.
        </p>
      </LegalSection>

      <LegalSection heading="7. Disclaimer and limitation of liability">
        <p>
          The Service is provided “as is” and “as available”, without warranties of any kind. To the maximum extent
          permitted by law, the maintainer is not liable for any indirect, incidental, or consequential damages, lost
          data, or costs (including third-party model charges) arising from your use of the Service.
        </p>
      </LegalSection>

      <LegalSection heading="8. Changes">
        <p>
          These terms may be updated as the Service evolves. Continued use after changes constitutes acceptance of the
          updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="9. Contact">
        <p>
          Questions about these terms? Contact us at <span style={{ color: '#f5f5f5' }}>support@palmkit.app</span>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
