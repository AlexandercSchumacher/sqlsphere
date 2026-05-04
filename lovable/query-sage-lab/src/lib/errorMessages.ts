// User-friendly error message mapping
// Technical errors are logged to console but users see friendly messages

const technicalErrorPatterns: { pattern: RegExp; friendlyMessage: string }[] = [
  { pattern: /edge function/i, friendlyMessage: 'connectionError' },
  { pattern: /network|fetch|timeout/i, friendlyMessage: 'networkError' },
  { pattern: /unauthorized|401|403/i, friendlyMessage: 'authError' },
  { pattern: /not found|404/i, friendlyMessage: 'notFoundError' },
  { pattern: /server|500|502|503/i, friendlyMessage: 'serverError' },
  { pattern: /database|connection refused|ECONNREFUSED/i, friendlyMessage: 'databaseError' },
  { pattern: /rate limit|too many requests|429/i, friendlyMessage: 'rateLimitError' },
];

export type ErrorMessageKey = 
  | 'connectionError'
  | 'networkError'
  | 'authError'
  | 'notFoundError'
  | 'serverError'
  | 'databaseError'
  | 'rateLimitError'
  | 'genericError';

/**
 * Converts technical error messages to user-friendly translation keys
 * Always logs the original error for debugging
 */
export function getErrorMessageKey(error: unknown): ErrorMessageKey {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Log the original technical error for debugging
  console.error('Technical error:', errorMessage);
  
  // Find matching pattern
  for (const { pattern, friendlyMessage } of technicalErrorPatterns) {
    if (pattern.test(errorMessage)) {
      return friendlyMessage as ErrorMessageKey;
    }
  }
  
  return 'genericError';
}

/**
 * Returns a user-friendly error message string using translation function
 */
export function getUserFriendlyError(error: unknown, t: (key: string) => string): string {
  const key = getErrorMessageKey(error);
  return t(`errors.${key}`);
}
