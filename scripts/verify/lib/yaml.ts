/**
 * Minimal YAML reader for config.yaml.
 *
 * `js-yaml` is only a transitive dependency (not importable under pnpm's strict
 * layout) and the harness must not add dependencies, so this parses the subset
 * config.yaml uses: block maps, block sequences (of scalars or maps), plain /
 * single / double-quoted scalars, `#` comments and `${VAR:-default}` strings
 * (kept verbatim). Flow collections, anchors and multi-line scalars are not
 * supported and throw.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [k: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  no: number;
}

function stripComment(s: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return JSON.parse(s);
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[") || s.startsWith("{")) {
    if (s === "[]") return [];
    if (s === "{}") return {};
    throw new Error(`Flow collections are not supported: ${s}`);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
    return s;
  }
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

/** Splits `key: value` at the first colon that is followed by space/EOL and is outside quotes. */
function splitKey(s: string): [string, string] | null {
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (
      c === ":" &&
      !inS &&
      !inD &&
      (i === s.length - 1 || s[i + 1] === " ")
    ) {
      let key = s.slice(0, i).trim();
      if (
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))
      ) {
        key = key.slice(1, -1);
      }
      return [key, s.slice(i + 1)];
    }
  }
  return null;
}

/**
 * Parses YAML text (subset, see file header).
 * @param text - Document text
 * @returns Parsed value
 */
export function parseYaml(text: string): YamlValue {
  const lines: Line[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const noComment = stripComment(rawLine);
    if (noComment.trim() === "") return;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ indent, text: noComment.trim(), no: i + 1 });
  });
  let pos = 0;

  function parseBlock(indent: number): YamlValue {
    if (pos >= lines.length) return null;
    const first = lines[pos];
    if (first.indent < indent) return null;
    if (first.text.startsWith("- ") || first.text === "-") {
      return parseSeq(first.indent);
    }
    return parseMap(first.indent);
  }

  function parseMap(indent: number): YamlValue {
    const out: { [k: string]: YamlValue } = {};
    while (pos < lines.length) {
      const ln = lines[pos];
      if (ln.indent < indent) break;
      if (ln.indent > indent)
        throw new Error(`Unexpected indent at line ${ln.no}`);
      if (ln.text.startsWith("- ")) break;
      const kv = splitKey(ln.text);
      if (!kv) throw new Error(`Expected key at line ${ln.no}: ${ln.text}`);
      pos++;
      const [k, rest] = kv;
      if (rest.trim() === "") {
        const next = lines[pos];
        if (
          next &&
          (next.indent > indent ||
            (next.indent === indent && next.text.startsWith("- ")))
        ) {
          out[k] = parseBlock(next.indent);
        } else {
          out[k] = null;
        }
      } else {
        out[k] = parseScalar(rest);
      }
    }
    return out;
  }

  function parseSeq(indent: number): YamlValue {
    const out: YamlValue[] = [];
    while (pos < lines.length) {
      const ln = lines[pos];
      if (ln.indent < indent) break;
      if (
        ln.indent !== indent ||
        !(ln.text.startsWith("- ") || ln.text === "-")
      )
        break;
      const itemText = ln.text === "-" ? "" : ln.text.slice(2);
      const itemIndent =
        indent + 2 + (itemText.length - itemText.trimStart().length);
      const trimmed = itemText.trim();
      if (trimmed === "") {
        pos++;
        out.push(parseBlock(lines[pos]?.indent ?? indent + 2));
        continue;
      }
      const kv = splitKey(trimmed);
      const isQuotedScalar = trimmed.startsWith('"') || trimmed.startsWith("'");
      if (kv && !isQuotedScalar) {
        // Map item: rewrite the line as a map entry at the item's indent.
        lines[pos] = { indent: itemIndent, text: trimmed, no: ln.no };
        out.push(parseMap(itemIndent));
      } else {
        pos++;
        out.push(parseScalar(trimmed));
      }
    }
    return out;
  }

  const v = parseBlock(0);
  if (pos < lines.length)
    throw new Error(`Unparsed content at line ${lines[pos].no}`);
  return v;
}
