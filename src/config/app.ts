/**
 * App identity. Rename the app by changing these constants; the page title,
 * PWA manifest and storage keys all read from here.
 */
export const APP_NAME = 'Cardly'
export const APP_DESCRIPTION = 'Turn your notes into flashcards and study them anywhere.'
/** Prefix for localStorage keys (theme, drafts, etc.). */
export const STORAGE_PREFIX = 'cardly'
export const THEME_COLOR = '#0d7a6f'
export const THEME_COLOR_DARK = '#0f1716'

/**
 * Gemini model behind AI Insight and AI Hint (Firebase AI Logic). Gemini models are retired
 * regularly; see https://firebase.google.com/docs/ai-logic/models and bump this.
 */
export const AI_MODEL = 'gemini-3.5-flash-lite'
