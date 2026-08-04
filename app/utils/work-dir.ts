/**
 * Where a project's files live.
 *
 * Two strings, split out of constants.ts so they can be read without it. That
 * module imports LLMManager, and through it every provider the app supports,
 * so anything wanting to know the working directory pulled in the whole model
 * layer to find out. The system prompt wants exactly this and nothing else,
 * which is what stopped it being shared with the worker that now runs it.
 */
export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
