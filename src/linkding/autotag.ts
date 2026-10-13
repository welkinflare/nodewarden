// Server-side automatic tagging (linkding parity).
// `auto_tagging_rules` is multiline text; each line has the form:
//
//   <pattern><whitespace><tag1,tag2,...>
//
// `pattern` matches against the full bookmark URL as a case-insensitive
// substring, or as a wildcard when it contains `*` (`*` spans any run of
// characters, matched anywhere in the URL). Blank lines, `#` comments and
// lines without tags are ignored. Tags after the first whitespace may be
// comma- or whitespace-separated. Returns matched tags in rule order,
// deduped case-insensitively.

export function applyAutoTags(url: string, rules: string): string[] {
  if (!url || !rules) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of rules.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.search(/\s/);
    if (sep <= 0) continue;
    const pattern = line.slice(0, sep);
    const tagsPart = line.slice(sep).trim();
    if (!pattern || !tagsPart) continue;
    if (!matchPattern(url, pattern)) continue;
    for (const tag of tagsPart.split(/[,\s]+/)) {
      const name = tag.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function matchPattern(url: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return url.toLowerCase().includes(pattern.toLowerCase());
  }
  const regex = new RegExp(
    pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*"),
    "i",
  );
  return regex.test(url);
}
