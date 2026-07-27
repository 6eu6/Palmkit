# Implementation Risks — palmkit.app Fork

## Technical Risks

### 1. WebContainer Mobile Browser Compatibility
**Severity: HIGH**

WebContainer requires SharedArrayBuffer, which demands cross-origin isolation via HTTP headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

These headers must be set by the server. In development, Wrangler sets them. In production on Cloudflare Pages, they are configured in the deployment.

**Mobile-specific concerns:**
- iOS Safari 15.2+ supports SharedArrayBuffer. Older versions do not.
- Android Chrome 92+ supports it. Older versions do not.
- Some enterprise browsers or browsers with reduced security features may not support it.

**Impact:** The entire coding workspace (live preview, file operations, terminal) depends on WebContainer. If it cannot boot, the app is a chat-only interface with no ability to run code.

**Mitigation:**
- Detect WebContainer support at boot time
- Provide a graceful "chat-only" fallback mode
- Clearly communicate minimum browser requirements
- Test on real iOS and Android devices early

### 2. Memory Constraints on Mobile
**Severity: HIGH**

WebContainer boots a full Node.js runtime in the browser. Combined with CodeMirror, xterm.js, and the preview iframe, memory usage can easily exceed 500MB. Mobile browsers have much lower memory limits:
- iOS Safari: ~1.5GB for web content, but individual tabs may be killed at ~300-500MB
- Android Chrome: varies by device, but typically 300-800MB per tab

**Impact:** App may crash, become unresponsive, or be killed by the OS on mobile devices, especially lower-end ones.

**Mitigation:**
- Lazy-load WebContainer (don't boot until user sends first "build" message)
- Don't initialize terminal until user navigates to Actions tab
- Use simpler code editor on mobile (syntax highlighting only, no linting)
- Consider not loading CodeMirror on mobile; use a read-only code view with tap-to-edit
- Monitor `performance.memory` API where available

### 3. Large Bundle Size
**Severity: MEDIUM**

The production build generates very large chunks (3.5MB+ for the Header chunk alone). This is problematic for mobile:
- Slow initial load on cellular networks
- High memory usage from parsing large JS bundles
- Some chunks may exceed V8's parser limits on older devices

**Impact:** Poor first-load experience on mobile. Users may abandon the app before it loads.

**Mitigation:**
- Implement code splitting for heavy components (CodeMirror, xterm, WebContainer)
- Use dynamic imports for mobile-conditional components
- Consider a separate lightweight mobile entry point
- Lazy-load provider implementations (22 providers, most unused by any single user)

### 4. Remix SSR/Client Hydration
**Severity: MEDIUM**

The app uses Remix with SSR. Some components are client-only (`.client.tsx` suffix). Mobile browsers may have slower hydration, causing:
- Flash of unstyled content (FOUC)
- Interactive elements that don't respond during hydration
- Mismatches between server and client rendered content

**Impact:** Poor perceived performance on mobile.

**Mitigation:**
- Use `ClientOnly` wrapper (already used in some places) for heavy components
- Add loading skeletons for mobile
- Test hydration timing on slow 3G connections

### 5. CSS/UnoCSS Responsive Gaps
**Severity: LOW-MEDIUM**

The current codebase uses UnoCSS with a `sm:` breakpoint at 640px. There is no `xs:` or `md:` breakpoint commonly used. Some components have hardcoded pixel widths that won't adapt well to mobile.

**Impact:** Layout may break or look poor on phones.

**Mitigation:**
- Audit all hardcoded pixel widths and replace with responsive values
- Add additional UnoCSS breakpoints (xs: 480px, md: 768px)
- Use `dvh` units instead of `vh` for full-height layouts

---

## Security Risks

### 1. API Key Storage in Cookies
**Severity: HIGH**

API keys are currently stored in browser cookies (`js-cookie`):
- `Cookies.set('apiKeys', JSON.stringify(keys))`
- `Cookies.set('selectedProvider', provider.name)`

**Problems:**
- Cookies are sent with every HTTP request to the same origin, including requests for static assets (images, CSS, JS). This means API keys are transmitted unnecessarily.
- Cookies are accessible to any JavaScript running on the same origin (XSS exposure).
- Cookie size limits (4KB) may be exceeded with many provider keys.
- No encryption at rest — cookies are stored in plaintext on disk.

**Impact:** If the app has an XSS vulnerability, all user API keys can be stolen. Keys are also exposed in browser developer tools and in cookie storage on the filesystem.

**Mitigation:**
- Move API key storage to `localStorage` with optional encryption (already partially used for provider settings)
- Stop sending API keys in cookies; send them only in the request body to `/api/chat`
- Consider using the Web Crypto API for client-side encryption of stored keys
- Add Content Security Policy (CSP) headers to reduce XSS risk
- For the BYOK model, this is especially critical — users are trusting us with their paid API keys

### 2. API Keys Sent to Server
**Severity: MEDIUM**

API keys are sent to the server in two ways:
1. As cookies (automatic with every request)
2. As part of the request body to `/api/chat`

The server then uses these keys to call LLM provider APIs. The keys pass through the server even though it's a BYOK model.

**Impact:** The server has access to all API keys. If the server is compromised, all user keys are exposed.

**Mitigation:**
- For a truly BYOK model, consider making LLM API calls directly from the client (if CORS allows)
- If server proxying is needed (likely for CORS), ensure keys are not logged
- Implement key rotation reminders
- Consider ephemeral key usage: use key for the API call, don't persist on server

### 3. XSS in Markdown Rendering
**Severity: MEDIUM**

The chat renders markdown from LLM responses using `react-markdown` with `rehype-raw` and `rehype-sanitize`. The sanitize step should prevent XSS, but:
- If sanitization is misconfigured, LLM-generated HTML could execute scripts
- The `<boltArtifact>` and `<boltAction>` tags are parsed from LLM output and could be injected

**Impact:** An LLM provider could potentially inject malicious content into the user's browser.

**Mitigation:**
- Ensure `rehype-sanitize` schema is restrictive
- Sanitize all LLM output before rendering
- Don't render raw HTML from LLM responses without sanitization
- Test with adversarial LLM outputs

### 4. WebContainer Code Execution
**Severity: MEDIUM**

WebContainer executes arbitrary code from the user's project. While it's sandboxed (runs in browser, no native binaries), there are still risks:
- Network requests from WebContainer could exfiltrate data
- The `node` runtime in WebContainer can make HTTP requests
- A malicious LLM response could inject code that makes external requests with stolen cookies

**Impact:** Data exfiltration via WebContainer network requests.

**Mitigation:**
- WebContainer network access is limited by the browser's same-origin policy
- Consider adding a network request allowlist for WebContainer
- Monitor outgoing network requests from the WebContainer context

---

## API Key Handling Risks

### 1. No Server-Side Validation
**Severity: MEDIUM**

API keys entered by the user are not validated before being used. If a user enters an invalid key:
- The error is only detected when the first API call is made
- The error message may not clearly indicate the key is invalid
- The user may waste time debugging other issues

**Impact:** Poor onboarding experience. Users may think the app is broken when they just entered a wrong key.

**Mitigation:**
- Add a "Test API Key" button that makes a simple API call to verify the key
- Provide clear error messages for common API key issues (invalid, expired, wrong format)
- Auto-detect key format and show validation hints

### 2. Key Rotation and Expiration
**Severity: LOW**

API keys can expire or be revoked. The app has no mechanism to detect this proactively.

**Impact:** Users may encounter cryptic errors during a session.

**Mitigation:**
- Detect 401/403 responses and prompt for key update
- Cache key validation status with TTL

### 3. Multiple Key Management
**Severity: LOW**

Users may have multiple API keys for the same provider. The current system only supports one key per provider.

**Impact:** Users cannot easily switch between keys or use different keys for different projects.

**Mitigation:**
- For MVP, single key per provider is acceptable
- For future: support key profiles or project-specific keys

---

## WebContainer / Mobile Browser Risks

### 1. Boot Time on Mobile
**Severity: MEDIUM**

WebContainer boot time on desktop is typically 3-5 seconds. On mobile, it could be significantly longer (10-30 seconds) due to:
- Slower CPU for WebAssembly compilation
- Less memory for the runtime
- Network latency for downloading the WebContainer bundle (~2MB)

**Impact:** Users may think the app is broken during the long boot time.

**Mitigation:**
- Show a progress indicator during WebContainer boot
- Pre-download the WebContainer bundle on WiFi
- Boot WebContainer in the background while the user is setting up API keys

### 2. Preview iframe on Mobile
**Severity: MEDIUM**

The preview iframe renders the user's project. On mobile:
- Touch events inside the iframe may not propagate correctly
- Scrolling inside the iframe can conflict with page scrolling
- The iframe may not respect `viewport` meta tags correctly

**Impact:** Preview may be difficult to interact with on mobile.

**Mitigation:**
- Test touch event handling in preview iframe
- Consider using `postMessage` for touch event relay
- Ensure preview uses responsive `viewport` meta tag

### 3. No WebAssembly Fallback
**Severity: HIGH**

WebContainer relies on WebAssembly. If WebAssembly is not available (very old browsers), the app cannot function.

**Impact:** Complete feature failure on unsupported browsers.

**Mitigation:**
- Detect WebAssembly support and show appropriate error
- Maintain minimum browser version documentation

---

## Performance Risks

### 1. Streaming Response Parsing
**Severity: LOW-MEDIUM**

The `StreamingMessageParser` parses XML-like tags from the streaming response character by character. On mobile with slower CPUs, this parsing may lag behind the streaming speed, causing:
- Delayed UI updates
- Janky scrolling
- Perceived lag in the chat interface

**Impact:** Poor chat experience on low-end devices.

**Mitigation:**
- Profile parser performance on mobile devices
- Consider batching parser updates (currently sampled at 50ms via `createSampler`)
- Optimize regex patterns in the parser

### 2. CodeMirror Performance
**Severity: MEDIUM**

CodeMirror 6 is performant, but on mobile:
- Large files may cause lag during editing
- Syntax highlighting for large files may be slow
- Touch selection can be imprecise

**Impact:** Poor editing experience on mobile.

**Mitigation:**
- Use read-only mode by default on mobile
- Limit file size for editing
- Use simpler syntax highlighting on mobile
- Consider a touch-optimized code editor (e.g., Monaco's mobile mode)

### 3. Framer Motion Animations
**Severity: LOW**

The app uses Framer Motion for animations. On mobile, these animations:
- May cause layout thrashing
- May trigger unnecessary re-renders
- May conflict with browser scroll optimizations

**Impact:** Janky animations on mobile.

**Mitigation:**
- Reduce animation complexity on mobile
- Use `will-change` CSS property for animated elements
- Consider disabling animations on low-end devices

---

## Risks of Modifying Core Runtime

### 1. Breaking the Streaming Protocol
**Severity: HIGH**

The streaming protocol between client and server uses a specific SSE format with data annotations. Modifying this format (e.g., adding new annotation types) could break:
- Existing chat history (messages stored in IndexedDB)
- Ongoing streaming responses
- The message parser

**Impact:** Complete chat failure.

**Mitigation:**
- Treat the streaming protocol as a versioned API
- Add new annotation types in a backward-compatible way
- Test with existing chat histories after any changes

### 2. Modifying the System Prompt
**Severity: HIGH**

The system prompt (`app/lib/common/prompts/prompts.ts`) is carefully crafted to produce `<boltArtifact>` and `<boltAction>` XML output from the LLM. Any changes to this prompt could:
- Break the message parser (which expects specific XML tags)
- Change the quality of LLM responses
- Introduce new failure modes

**Impact:** LLM may stop producing valid file actions.

**Mitigation:**
- Test prompt changes with multiple LLM providers
- Keep a backup of the working prompt
- Use prompt versioning
- Add integration tests for prompt → parse → action pipeline

### 3. Modifying the Action Runner
**Severity: MEDIUM**

The ActionRunner executes file and shell actions in WebContainer. Changes here could:
- Break file writes (wrong paths, encoding issues)
- Break shell command execution
- Introduce security vulnerabilities

**Impact:** Projects may not build or run correctly.

**Mitigation:**
- Add comprehensive tests for ActionRunner
- Test with real projects after any changes
- Keep action types backward-compatible

### 4. Changing the WebContainer Boot Process
**Severity: HIGH**

WebContainer boot is fragile and depends on:
- Specific COEP/COOP headers
- Specific WebContainer API version
- Specific browser features (SharedArrayBuffer)

**Impact:** WebContainer may fail to boot, making the entire workspace non-functional.

**Mitigation:**
- Do not modify WebContainer boot code unless absolutely necessary
- Do not change WebContainer API version without thorough testing
- Keep the boot process as-is and wrap it with error handling

---

## Licensing / Attribution Notes

### License: MIT
The palmkit.app project is licensed under the MIT License (see `LICENSE` file):
- Copyright (c) 2024 StackBlitz, Inc. and palmkit.app contributors
- Permission is granted to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
- The license notice must be included in all copies or substantial portions

### Attribution Requirements
1. **Must include**: The original MIT license and copyright notice in our project
2. **Must not**: Claim the original work as our own or remove attribution
3. **Should**: Credit palmkit.app and StackBlitz in our README and about page
4. **Should**: Contribute non-proprietary improvements back to the upstream project if appropriate

### WebContainer License
- `@webcontainer/api` is published by StackBlitz
- Version 1.6.1-internal.1 — this is an "internal" version, which may have different licensing terms
- Must verify if this internal version has any restrictions on commercial use
- The standard WebContainer API is under a custom license that allows non-commercial use

**Risk:** The "internal" version of the WebContainer API may have restrictions. Must review the actual license of this specific version.

### Other Dependencies
Most dependencies are MIT or Apache-2.0 licensed. Key exceptions to verify:
- `@webcontainer/api` — StackBlitz custom license
- `@remix-run/cloudflare` — MIT
- `ai` (Vercel AI SDK) — Apache-2.0

---

## Anything That Could Break Existing palmkit.app Functionality

### 1. Adding Mobile Components
**Risk Level: LOW** (if done correctly)

If mobile components are added as separate files that conditionally render, they should not affect desktop functionality. However:
- If shared components are modified to accept mobile props, it could introduce regressions
- If CSS is modified without proper scoping, desktop styles could be affected

### 2. Modifying the Routing Structure
**Risk Level: MEDIUM**

Adding new routes could conflict with existing ones. Removing or renaming routes would break existing chat URLs (e.g., `/chat/123`).

### 3. Modifying State Management
**Risk Level: MEDIUM**

Adding new Nanostore atoms is safe. Modifying existing atoms (changing shape, adding required fields) could break components that read from them.

### 4. Changing the Build Configuration
**Risk Level: HIGH**

Modifying `vite.config.ts`, `tsconfig.json`, or `wrangler.toml` could:
- Break the production build
- Break Cloudflare Pages deployment
- Break Electron builds

### 5. Updating Dependencies
**Risk Level: MEDIUM-HIGH**

The project pins specific versions of most dependencies. Updating them could:
- Break the AI SDK integration (frequently changing API)
- Break WebContainer integration (version-specific)
- Introduce type errors
- Change runtime behavior

### 6. Modifying the Chat History Schema
**Risk Level: HIGH**

Chat history is stored in IndexedDB with a specific schema. Changes to the schema (adding fields, changing types) could:
- Break existing chat histories
- Require migration logic
- Cause data loss if not handled carefully

---

## Summary Risk Matrix

| Risk | Severity | Likelihood | Impact | Mitigation Priority |
|------|----------|------------|--------|-------------------|
| WebContainer mobile compatibility | HIGH | MEDIUM | Complete feature failure | P0 — Test early |
| API key cookie storage | HIGH | HIGH | Key theft via XSS | P0 — Fix before launch |
| Memory on mobile | HIGH | HIGH | App crashes | P1 — Optimize loading |
| WebContainer boot time | MEDIUM | HIGH | Poor UX | P1 — Add progress UI |
| Large bundle size | MEDIUM | HIGH | Slow mobile load | P1 — Code splitting |
| Breaking streaming protocol | HIGH | LOW | Chat failure | P2 — Version the protocol |
| System prompt changes | HIGH | LOW | LLM output breaks | P2 — Test thoroughly |
| WebContainer API license | MEDIUM | LOW | Legal issues | P2 — Verify license |
| iOS 100vh bug | LOW | HIGH | Layout issues | P3 — Use dvh units |
| Virtual keyboard overlap | MEDIUM | HIGH | Input hidden | P3 — visualViewport API |
