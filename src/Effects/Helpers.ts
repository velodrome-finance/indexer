/**
 * Error types that can be detected from error messages
 */
export enum ErrorType {
  RATE_LIMIT = "RATE_LIMIT",
  OUT_OF_GAS = "OUT_OF_GAS",
  CONTRACT_REVERT = "CONTRACT_REVERT",
  NETWORK_ERROR = "NETWORK_ERROR",
  HISTORICAL_STATE_NOT_AVAILABLE = "HISTORICAL_STATE_NOT_AVAILABLE",
  UNKNOWN = "UNKNOWN",
}

/**
 * Error keyword mappings for each error type
 * Note: Order matters - more specific errors should be checked first
 */
const ERROR_KEYWORDS: Record<ErrorType, string[]> = {
  [ErrorType.OUT_OF_GAS]: [
    "out of gas",
    "gas exhausted",
    "gas required exceeds",
    "gas limit exceeded",
    "gas limit",
  ],
  [ErrorType.HISTORICAL_STATE_NOT_AVAILABLE]: [
    "historical state",
    "is not available",
    "historical state not available",
    "state histories haven't been fully indexed",
    "state histories",
    "haven't been fully indexed",
  ],
  [ErrorType.CONTRACT_REVERT]: ["reverted", "revert", "execution reverted"],
  [ErrorType.RATE_LIMIT]: [
    "rate limit",
    "rate limit exceeded",
    "requests per second",
    "429",
    "too many requests",
  ],
  [ErrorType.NETWORK_ERROR]: [
    "network error",
    "connection error",
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "fetch failed",
    "request timeout",
    "connection timeout",
    "read timeout",
    "write timeout",
    "timeout exceeded",
    "aborted",
    "network request failed",
    "failed to fetch",
    "connection closed",
    "socket closed",
    "premature close",
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

/**
 * Creates a readable error with preserved stack trace
 * @param error - The original error
 * @param context - Context string (e.g., "[getTokenDetails]")
 * @param details - Key-value pairs to include in error message
 * @returns A new Error with readable message and preserved stack trace
 */
export function createReadableError(
  error: unknown,
  context: string,
  details: Record<string, string | number>,
): Error {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const detailStr = Object.entries(details)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const readableError = new Error(`${context} ${detailStr} - ${errorMessage}`);

  if (error instanceof Error && error.stack) {
    readableError.stack = error.stack;
  }

  return readableError;
}

/**
 * Standard error handler for effects that return fallback values
 * All effects should return fallback values to prevent indexer crashes.
 * Errors are always logged for debugging purposes.
 *
 * @param error - The original error
 * @param context - Effect context with cache and log
 * @param effectName - Name of the effect (e.g., "getTokenDetails")
 * @param details - Key-value pairs for error message
 * @param fallbackValue - Value to return on error
 * @returns The fallback value
 */
export function handleEffectErrorReturn<T>(
  error: unknown,
  context: {
    cache?: boolean;
    log: { error: (msg: string, err: Error) => void };
  },
  effectName: string,
  details: Record<string, string | number>,
  fallbackValue: T,
): T {
  context.cache = false;
  const readableError = createReadableError(error, `[${effectName}]`, details);
  context.log.error(readableError.message, readableError);
  return fallbackValue;
}
