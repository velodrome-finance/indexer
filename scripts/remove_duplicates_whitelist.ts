// Run with: deno run --allow-read --allow-write --node-modules-dir scripts/remove_duplicates_whitelist.ts

// Import necessary modules
import { parse, stringify, Column } from "https://deno.land/std@0.224.0/csv/mod.ts";
import Web3 from "npm:web3@4.0.1";

// Initialize Web3
const web3 = new Web3();

// Function to read CSV, checksum addresses, and return a Map of unique addresses
async function loadAndDeduplicateCSV(filePath: string): Promise<Map<string, string>> {
  const fileContent = await Deno.readTextFile(filePath);
  const records = parse(fileContent, { skipFirstRow: true, columns: ["address", "blocktime"] });
  const uniqueAddresses = new Map<string, string>();

  for (const record of records) {
    const address = web3.utils.toChecksumAddress(record.address);
    const blocktime = record.blocktime;
    // If the checksummed address is not already in the map, add it
    if (!uniqueAddresses.has(address)) {
      uniqueAddresses.set(address, blocktime);
    }
  }

  return uniqueAddresses;
}

// Main function to process the CSV file
async function deduplicateCSV() {
  const inputFilePath = "src/constants/Aerodrome-Whitelisted.csv";
  const outputFilePath = "src/constants/Aerodrome-Whitelisted.csv";

  const uniqueAddresses = await loadAndDeduplicateCSV(inputFilePath);

  // Convert the map to an array of objects for CSV writing
  const deduplicatedEntries = Array.from(uniqueAddresses.entries()).map(([address, blocktime]) => ({
    address,
    blocktime,
  }));

  const columns: Column[] = ["address", "blocktime"];

  // Convert deduplicated entries to CSV format
  const csvContent = stringify(deduplicatedEntries, {columns});

  // Write deduplicated entries to a CSV file
  await Deno.writeTextFile(outputFilePath, csvContent);
}

deduplicateCSV().catch(console.error);