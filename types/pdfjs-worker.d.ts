/**
 * Type declarations for pdfjs-dist worker module.
 *
 * pdfjs-dist v6 ships the worker as a separate .mjs file. TypeScript
 * doesn't have built-in types for this sub-module, so we declare it
 * as `any` to allow dynamic imports without type errors.
 *
 * The worker is only loaded client-side (in DocumentContentRenderer)
 * via `await import('pdfjs-dist/build/pdf.worker.min.mjs')`.
 */

declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  const workerSrc: string;
  export default workerSrc;
}

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  const workerSrc: string;
  export default workerSrc;
}
