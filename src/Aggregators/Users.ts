import type { User, handlerContext } from "generated";

/**
 * Creates a new User entity
 */
export function createUserEntity(
  userAddress: string,
  chainId: number,
  timestamp: Date,
): User {
  return {
    id: userAddress.toLowerCase(),
    chainId,
    numberOfSwaps: 0n,
    totalSwapVolumeUSD: 0n,
    totalFeesContributedUSD: 0n,
    totalFeesContributed0: 0n,
    totalFeesContributed1: 0n,
    joined_at_timestamp: timestamp,
    last_activity_timestamp: timestamp,
  };
}

/**
 * Updates a User entity with fee contribution data
 */
export async function updateUserFeeContribution(
  userAddress: string,
  chainId: number,
  feesContributedUSD: bigint,
  feesContributed0: bigint,
  feesContributed1: bigint,
  timestamp: Date,
  context: handlerContext,
): Promise<User> {
  // Get existing user or create new one
  let existingUser = await context.User.get(userAddress.toLowerCase());

  if (!existingUser) {
    existingUser = createUserEntity(userAddress, chainId, timestamp);
  }

  // Update user with fee contributions
  const updatedUser: User = {
    ...existingUser,
    totalFeesContributedUSD:
      existingUser.totalFeesContributedUSD + feesContributedUSD,
    totalFeesContributed0:
      existingUser.totalFeesContributed0 + feesContributed0,
    totalFeesContributed1:
      existingUser.totalFeesContributed1 + feesContributed1,
    last_activity_timestamp: timestamp,
  };

  context.User.set(updatedUser);
  return updatedUser;
}
