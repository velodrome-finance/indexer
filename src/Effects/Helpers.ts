/**
 * Error types that can be detected from error messages
 */
export enum ErrorType {
  RATE_LIMIT = "RATE_LIMIT",
  OUT_OF_GAS = "OUT_OF_GAS",
  CONTRACT_REVERT = "CONTRACT_REVERT",
  UNKNOWN = "UNKNOWN",
}

/**
 * Error keyword mappings for each error type
p * Note: Order matters - more specific errors should be checked first
 */
const ERROR_KEYWORDS: Record<ErrorType, string[]> = {
  [ErrorType.OUT_OF_GAS]: [
    "out of gas",
    "gas exhausted",
    "gas required exceeds",
    "gas limit exceeded",
    "gas limit",
  ],
  [ErrorType.CONTRACT_REVERT]: ["reverted", "revert", "execution reverted"],
  [ErrorType.RATE_LIMIT]: [
    "rate limit",
    "rate limit exceeded",
    "requests per second",
    "429",
    "too many requests",
  ],
  [ErrorType.UNKNOWN]: [],
};

/**
 * Determines the type of error from the error message and stack trace
 * @param error - The error to analyze
 * @returns The ErrorType enum value
 */
export function getErrorType(error: unknown): ErrorType {
  if (!error) return ErrorType.UNKNOWN;

  const errorString = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : String(error);
  const combinedText = `${errorString} ${errorStack}`.toLowerCase();

  for (const errorType of Object.keys(ERROR_KEYWORDS)) {
    const keywords = ERROR_KEYWORDS[errorType as ErrorType];
    if (
      keywords.some((keyword) => combinedText.includes(keyword.toLowerCase()))
    )
      return errorType as ErrorType;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Helper function to sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
