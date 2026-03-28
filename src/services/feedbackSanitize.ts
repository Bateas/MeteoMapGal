/** Feedback types — shared between modal and webhook client */
export type FeedbackType = 'sugerencia' | 'bug' | 'otro';
export const VALID_TYPES: FeedbackType[] = ['sugerencia', 'bug', 'otro'];

export const MAX_CHARS = 300;

// Only allow safe characters: letters, numbers, basic punctuation
const SAFE_CHARS = /[^a-zA-Z0-9\u00C0-\u024F\s.,!?¿¡:;()\-'/]/g;

/** Sanitize user input — strip HTML, control chars, dangerous patterns, SQL keywords */
export function sanitize(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')                    // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .replace(/javascript\s*:/gi, '')            // javascript: protocol
    .replace(/data\s*:/gi, '')                  // data: protocol
    .replace(/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|UNION)\s+(TABLE|FROM|INTO|DATABASE|SELECT)/gi, '') // SQL injection keywords
    .replace(SAFE_CHARS, '')                     // only safe chars
    .trim()
    .substring(0, MAX_CHARS);
}
