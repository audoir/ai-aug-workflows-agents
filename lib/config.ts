/**
 * Application configuration
 *
 * To override the default model, set the OPENAI_MODEL environment variable.
 * Example: OPENAI_MODEL=gpt-5.4-mini
 */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";