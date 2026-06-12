/**
 * Renders an audit Markdown report (e.g. integrity-audit output) to a
 * self-contained dark-themed HTML page. Handles the limited Markdown subset
 * the audit emits: headings, paragraphs, bullet lists, GFM tables, inline
 * code, bold, and italics.
 *
 * Usage:
 *   pnpm dlx tsx scripts/audit-md-to-html.ts <input.md> <output.html>
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  process.stderr.write(
    "usage: tsx scripts/audit-md-to-html.ts <input.md> <output.html>\n",
  );
  process.exit(1);
}

let md: string;
try {
  md = readFileSync(inputPath, "utf-8");
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`[audit-md-to-html] failed to read ${inputPath}: ${msg}`);
}

// ----------------------------------------------------------------------------
// Inline rendering
// ----------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(s: string): string {
  // Backtick code first (so its content isn't touched by emphasis rules).
  const codeSlots: string[] = [];
  let out = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codeSlots.push(`<code>${escapeHtml(c)}</code>`);
    return ` CODE${codeSlots.length - 1} `;
  });
  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,!?])/g, "$1<em>$2</em>");
  out = out.replace(/ CODE(\d+) /g, (_m, i) => codeSlots[Number(i)]);
  return out;
}

// ----------------------------------------------------------------------------
// Block parsing
// ----------------------------------------------------------------------------

const lines = md.split("\n");
const html: string[] = [];
let i = 0;

function isTableDelim(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

while (i < lines.length) {
  const line = lines[i];

  // Blank line - separator only
  if (line.trim() === "") {
    i++;
    continue;
  }

  // Headings
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    html.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
    i++;
    continue;
  }

  // GFM table: current line is header + next line is delim
  if (
    line.includes("|") &&
    i + 1 < lines.length &&
    isTableDelim(lines[i + 1])
  ) {
    const header = splitRow(line);
    i += 2; // skip header + delim
    const rows: string[][] = [];
    while (
      i < lines.length &&
      lines[i].includes("|") &&
      lines[i].trim() !== ""
    ) {
      rows.push(splitRow(lines[i]));
      i++;
    }
    html.push("<table>");
    html.push(
      `<thead><tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`,
    );
    html.push("<tbody>");
    for (const r of rows) {
      html.push(
        `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`,
      );
    }
    html.push("</tbody></table>");
    continue;
  }

  // Bullet list
  if (/^\s*-\s+/.test(line)) {
    html.push("<ul>");
    while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
      const item = lines[i].replace(/^\s*-\s+/, "");
      html.push(`<li>${renderInline(item)}</li>`);
      i++;
    }
    html.push("</ul>");
    continue;
  }

  // Paragraph - gather until blank line
  const para: string[] = [line];
  i++;
  while (
    i < lines.length &&
    lines[i].trim() !== "" &&
    !lines[i].match(/^(#{1,6})\s+/) &&
    !/^\s*-\s+/.test(lines[i]) &&
    !(
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      isTableDelim(lines[i + 1])
    )
  ) {
    para.push(lines[i]);
    i++;
  }
  html.push(`<p>${renderInline(para.join(" "))}</p>`);
}

// ----------------------------------------------------------------------------
// Frame
// ----------------------------------------------------------------------------

const titleMatch = md.match(/^#\s+(.+)$/m);
const title = titleMatch ? titleMatch[1] : "Audit report";

const css = `
:root {
  --bg: #0e1116;
  --fg: #e6edf3;
  --muted: #8b949e;
  --line: #30363d;
  --link: #58a6ff;
  --code-bg: #161b22;
  --row-stripe: rgba(255,255,255,0.02);
  --row-hover: rgba(88,166,255,0.07);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body {
  padding: 32px 48px 96px;
  font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
main { max-width: 1280px; margin: 0 auto; }
h1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 28px; margin: 0 0 8px; }
h2 {
  font-size: 22px;
  margin: 40px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
h3 {
  font-size: 14.5px;
  margin: 28px 0 8px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  color: var(--fg);
}
p { margin: 8px 0; color: var(--fg); }
em { color: var(--muted); font-style: italic; }
strong { color: #ffd166; font-weight: 600; }
ul { margin: 8px 0 16px; padding-left: 22px; }
li { margin: 2px 0; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 12.5px;
  background: var(--code-bg);
  padding: 1px 5px;
  border-radius: 4px;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0 20px;
  font-size: 12.5px;
}
th, td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  word-break: break-word;
}
th {
  background: var(--code-bg);
  font-weight: 600;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
tbody tr:nth-child(even) td { background: var(--row-stripe); }
tbody tr:hover td { background: var(--row-hover); }
td code { font-size: 11.5px; }
`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<main>
${html.join("\n")}
</main>
</body>
</html>
`;

try {
  writeFileSync(outputPath, out);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`[audit-md-to-html] failed to write ${outputPath}: ${msg}`);
}
process.stderr.write(`wrote ${outputPath}\n`);
