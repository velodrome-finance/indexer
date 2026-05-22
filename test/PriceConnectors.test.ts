import { describe, expect, it } from "vitest";
import priceConnectorsJson from "../src/constants/price_connectors.json" with {
  type: "json",
};

type PriceConnector = { address: string; createdBlock: number };
const connectors = priceConnectorsJson as Record<string, PriceConnector[]>;

// OP-Stack and Frax pre-deploys live at the chain's genesis block. The audit
// (scripts/audit-connector-created-blocks.ts) reports their on-chain deploy as
// block 0; keeping createdBlock = 1 in the JSON is conservative (one block
// later than the earliest valid query) and still satisfies the configured >=
// real_deploy invariant. Listed here so the "no low createdBlock" assertion
// below has a precise allowlist instead of a heuristic.
const PRE_DEPLOY_OK = new Set<string>([
  "optimism|0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9",
  "optimism|0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  "optimism|0xc40f949f8a4e094d1b49a23ea9241d289b7b2819",
  "optimism|0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
  "optimism|0x4200000000000000000000000000000000000006",
  "optimism|0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
  "optimism|0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  "base|0x4200000000000000000000000000000000000006",
  "mode|0x4200000000000000000000000000000000000006",
  "lisk|0x4200000000000000000000000000000000000006",
  "fraxtal|0xFC00000000000000000000000000000000000005",
  "fraxtal|0xFC00000000000000000000000000000000000006",
  "fraxtal|0xFc00000000000000000000000000000000000001",
  "soneium|0x4200000000000000000000000000000000000006",
  "ink|0x4200000000000000000000000000000000000006",
  "metal|0x4200000000000000000000000000000000000006",
  "unichain|0x4200000000000000000000000000000000000006",
  "superseed|0x4200000000000000000000000000000000000006",
  "swellchain|0x4200000000000000000000000000000000000006",
]);

/**
 * Snapshot of every createdBlock in price_connectors.json after the #764 audit.
 * Any edit to price_connectors.json must also update this map, which forces
 * the editor to acknowledge the change rather than silently regressing a
 * connector to `createdBlock: 1` (the failure mode that produced #763).
 *
 * When adding or correcting a connector, find the address's real on-chain
 * deploy block (binary-search `eth_getCode` against any archive RPC for the
 * chain) and use that value here — never a placeholder.
 */
const EXPECTED_CREATED_BLOCKS: Record<string, Record<string, number>> = {
  optimism: {
    "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db": 105896796,
    "0x4200000000000000000000000000000000000042": 6490467,
    "0x9bcef72be871e61ed4fbbc7630889bee758eb81d": 113681,
    "0x2e3d870790dc77a83dd1d18184acc7439a53f475": 2153157,
    "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9": 1,
    "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb": 17831118,
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1": 1,
    "0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40": 89899840,
    "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819": 1,
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": 1,
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": 38198364,
    "0x4200000000000000000000000000000000000006": 1,
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607": 1,
    "0x68f180fcCe6836688e9084f035309E29Bf0A2095": 1,
    "0x01bFF41798a0BcF287b996046Ca68b395DbC1071": 133193269,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 132196375,
  },
  base: {
    "0x940181a94A35A4569E4529A3CDfB74e38FD98631": 3200550,
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": 1569598,
    "0x4621b7a9c75199271f773ebd9a499dbd165c3191": 2361818,
    "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": 1600576,
    "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": 4572990,
    "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": 15107859,
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 2062407,
    "0x4200000000000000000000000000000000000006": 1,
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": 2797221,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 26601141,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34": 15768548,
  },
  mode: {
    "0x4200000000000000000000000000000000000006": 1,
    "0xDfc7C877a950e49D2610114102175A06C2e3167a": 7103932,
    "0xd988097fb8612cc24eeC14542bC03424c656005f": 190687,
    "0xf0F161fDA2712DB8b566946122a5af183995e2eD": 190688,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 19912179,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34": 5056706,
  },
  lisk: {
    "0x05D032ac25d322df992303dCa074EE7392C117b9": 1639961,
    "0xF242275d3a6527d877f2c927a82D9b057609cc71": 6495207,
    "0x4200000000000000000000000000000000000006": 1,
    "0xac485391EB2d7D88253a7F1eF18C37f4242D1A24": 568336,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 8339184,
  },
  fraxtal: {
    "0xFC00000000000000000000000000000000000005": 1,
    "0xFC00000000000000000000000000000000000006": 1,
    "0xFc00000000000000000000000000000000000001": 1,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34": 1735141,
    "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2": 1735172,
    "0xDcc0F2D8F90FDe85b10aC1c8Ab57dc0AE946A543": 935088,
    // 0x1217… (oUSDT on other chains) was dropped from Fraxtal connectors —
    // the contract at that address on Fraxtal is not canonical oUSDT (#764).
  },
  soneium: {
    "0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369": 951811,
    "0x4200000000000000000000000000000000000006": 1,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 1860039,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 3428547,
  },
  ink: {
    "0xF1815bd50389c46847f0Bda824eC8da914045D14": 1046622,
    "0x4200000000000000000000000000000000000006": 1,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 3352827,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 6493397,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34": 28067776,
    "0x2D270e6886d130D724215A266106e6832161EAEd": 22300765,
  },
  metal: {
    "0xb91CFCcA485C6E40E3bC622f9BFA02a8ACdEeBab": 78221,
    "0x4200000000000000000000000000000000000006": 1,
    "0xBCFc435d8F276585f6431Fc1b9EE9A850B5C00A9": 79540,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 11435849,
  },
  unichain: {
    "0x4200000000000000000000000000000000000006": 1,
    "0x078D782b760474a361dDA0AF3839290b0EF57AD6": 98792,
    "0x588CE4F028D8e7B53B687865d6A67b3A54C75518": 7961962,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 9386044,
    "0x8f187aA05619a017077f5308904739877ce9eA21": 7941965,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 9243349,
  },
  celo: {
    "0xD221812de1BD094f35587EE8E174B07B6167D9Af": 31062796,
    "0x471EcE3750Da237f93B8E339c536989b8978a438": 2919,
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e": 24500562,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 31609122,
    "0xcebA9300f2b948710d2653dD7B07f33A8B32118C": 23412006,
  },
  superseed: {
    "0x4200000000000000000000000000000000000006": 1,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 4126563,
    "0xC316C8252B5F2176d0135Ebb0999E99296998F2e": 5057169,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 6906221,
  },
  swellchain: {
    "0x4200000000000000000000000000000000000006": 1,
    "0x7f9AdFbd38b669F03d1d11000Bc76b9AaEA28A81": 3717939,
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34": 836634,
    "0x0000bAa0b1678229863c0A941C1056b83a1955F5": 7216771,
    "0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189": 8603184,
    "0x9ab96A4668456896d45c301Bc3A15Cee76AA7B8D": 5112321,
  },
};

describe("price_connectors.json createdBlock snapshot (#764)", () => {
  it("matches the expected createdBlock for every (chain, address)", () => {
    for (const [chain, list] of Object.entries(connectors)) {
      const expected = EXPECTED_CREATED_BLOCKS[chain];
      expect(
        expected,
        `missing expected snapshot for chain "${chain}"`,
      ).toBeDefined();
      for (const entry of list) {
        expect(
          entry.createdBlock,
          `${chain} ${entry.address}: createdBlock drift`,
        ).toBe(expected[entry.address]);
      }
    }
  });

  it("covers every snapshot key with an entry in the JSON", () => {
    // Catches the reverse drift: a snapshot entry whose address was removed
    // from the JSON without updating EXPECTED_CREATED_BLOCKS.
    for (const [chain, expected] of Object.entries(EXPECTED_CREATED_BLOCKS)) {
      const actual = new Set((connectors[chain] ?? []).map((c) => c.address));
      for (const address of Object.keys(expected)) {
        expect(
          actual.has(address),
          `${chain} ${address}: in snapshot but missing from JSON`,
        ).toBe(true);
      }
    }
  });

  it("rejects placeholder createdBlock=1 outside the genesis pre-deploy allowlist", () => {
    // #763 was caused by a connector silently shipping with createdBlock=1
    // even though its real deploy was at block 15768548. This guard ensures
    // any *future* connector added with a placeholder is caught at test time.
    for (const [chain, list] of Object.entries(connectors)) {
      for (const entry of list) {
        if (entry.createdBlock !== 1) continue;
        const key = `${chain}|${entry.address}`;
        expect(
          PRE_DEPLOY_OK.has(key),
          `${chain} ${entry.address}: createdBlock=1 not in PRE_DEPLOY_OK; run the audit script`,
        ).toBe(true);
      }
    }
  });
});
