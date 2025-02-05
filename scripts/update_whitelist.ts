// Run with: deno run --allow-read --allow-write --node-modules-dir scripts/update_whitelist.ts

import { parse, stringify, Column } from "https://deno.land/std@0.224.0/csv/mod.ts";

// Function to read CSV and return a Set of addresses
async function loadCSVAddresses(filePath: string): Promise<Set<string>> {
  const fileContent = await Deno.readTextFile(filePath);
  const records = parse(fileContent, { skipFirstRow: true, columns: ["address", "blocktime"] });
  const addresses = new Set<string>();
  for (const record of records) {
    addresses.add(record.address); // Assuming the address is the first column
  }
  return addresses;
}

// Function to read JSON and return the relevant data
async function loadJSONData(filePath: string): Promise<any[]> {
  const jsonData = await Deno.readTextFile(filePath);
  const data = JSON.parse(jsonData);
  return data.data.Voter_WhitelistToken;
}

// Main function to process the data
async function processWhitelistData() {
  const csvFilePath = "src/constants/Aerodrome-Whitelisted.csv";
  const jsonFilePath = "src/constants/whitelisted_base.json";
  const outputFilePath = "src/constants/New-Whitelisted.csv";

  const existingAddresses = await loadCSVAddresses(csvFilePath);
  const jsonData = await loadJSONData(jsonFilePath);

  const newEntries = [];

  for (const entry of jsonData) {
    const address = entry.token;
    const blocktime = entry.id.split("_")[1];

    if (!existingAddresses.has(address)) {
      newEntries.push({ address, blocktime });
    }
  }

  const columns: Column[] = ["address", "blocktime"];

  // Convert new entries to CSV format
  const csvContent = stringify(newEntries, {columns});

  // Write new entries to a CSV file
  await Deno.writeTextFile(outputFilePath, csvContent);
}

processWhitelistData().catch(console.error);