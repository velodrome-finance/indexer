/**
 * Helper function to check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;

  const errorString = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : String(error);

  // Check for rate limit keywords in error message or stack
  const rateLimitKeywords = [
    "rate limit",
    "exceeded",
    "requests per second",
    "429",
    "too many requests",
  ];

  const combinedText = `${errorString} ${errorStack}`.toLowerCase();

  return rateLimitKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );
}

/**
 * Helper function to check if an error is an "out of gas" error
 */
export function isOutOfGasError(error: unknown): boolean {
  if (!error) return false;

  const errorString = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : String(error);

  // Check for out of gas keywords in error message or stack
  const outOfGasKeywords = ["out of gas", "gas exhausted", "gas limit"];

  const combinedText = `${errorString} ${errorStack}`.toLowerCase();

  return outOfGasKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );
}

/**
 * Helper function to check if an error is a contract revert error
 */
export function isContractRevertError(error: unknown): boolean {
  if (!error) return false;

  const errorString = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : String(error);

  // Check for revert keywords in error message or stack
  const revertKeywords = ["reverted", "revert", "execution reverted"];

  const combinedText = `${errorString} ${errorStack}`.toLowerCase();

  return revertKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );
}

/**
 * Helper function to sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
