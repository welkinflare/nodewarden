// Search query compiler (linkding parity).
// Supported syntax:
//
//   #tag            tag filter (strict: exact NOCASE match,
//                   loose: name-prefix match via prefs.tag_search)
//   "phrase"        multi-word text phrase
//   !term / -term   exclusion (works for text, phrases and #tags)
//   A OR B          boolean OR of AND-groups (only uppercase OR splits;
//                   everything else ANDs implicitly)
//
// Text terms match title/description/url/notes with parameterized LIKE.
// Tag terms compile to correlated EXISTS subqueries pinned to the same
// user (`tags.user_id = bookmarks.user_id`), so plans stay correct under
// the outer `bookmarks.user_id = ?` filter without extra bind params.
// Raw user input never enters the SQL string — only `?` placeholders.

export interface SearchPrefs {
  tag_search?: string;
}

export interface SqlPlan {
  // Extra FROM fragments (reserved; currently always "").
  joins: string;
  // WHERE fragment without the WHERE keyword ("1=1" when query is empty).
  where: string;
  // Bind params for `where` (and `joins`), in order.
  params: unknown[];
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function parseQuery(q: string, prefs?: SearchPrefs): SqlPlan {
  const strict = (prefs?.tag_search ?? "strict").toLowerCase() !== "loose";

  const tokens: string[] = [];
  const quoted: boolean[] = [];
  const tokenRe = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  const input = q ?? "";
  while ((m = tokenRe.exec(input)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(m[1]);
      quoted.push(true);
    } else {
      tokens.push(m[2]);
      quoted.push(false);
    }
  }

  const groups: Array<Array<{ tok: string; isQuoted: boolean }>> = [[]];
  tokens.forEach((tok, i) => {
    if (!quoted[i] && tok === "OR") {
      groups.push([]);
      return;
    }
    groups[groups.length - 1].push({ tok, isQuoted: quoted[i] });
  });

  const params: unknown[] = [];
  const groupSql: string[] = [];
  let tagIdx = 0;
  for (const group of groups) {
    const parts: string[] = [];
    for (const { tok, isQuoted } of group) {
      let text = tok;
      let negated = false;
      if (!isQuoted && (text.startsWith("!") || text.startsWith("-")) && text.length > 1) {
        negated = true;
        text = text.slice(1);
      }
      if (!isQuoted && text.startsWith("#") && text.length > 1) {
        const name = text.slice(1);
        const n = tagIdx++;
        const cond = strict
          ? `t${n}.name = ?`
          : `t${n}.name LIKE ? ESCAPE '\\'`;
        const exists =
          `EXISTS (SELECT 1 FROM bookmark_tags bt${n} ` +
          `JOIN tags t${n} ON t${n}.id = bt${n}.tag_id ` +
          `WHERE bt${n}.bookmark_id = bookmarks.id ` +
          `AND t${n}.user_id = bookmarks.user_id AND ${cond})`;
        params.push(strict ? name : `${escapeLike(name)}%`);
        parts.push(negated ? `NOT (${exists})` : exists);
        continue;
      }
      const term = isQuoted ? tok : text;
      if (term === "") continue;
      const like =
        `(bookmarks.title LIKE ? ESCAPE '\\' ` +
        `OR bookmarks.description LIKE ? ESCAPE '\\' ` +
        `OR bookmarks.url LIKE ? ESCAPE '\\' ` +
        `OR bookmarks.notes LIKE ? ESCAPE '\\')`;
      const pattern = `%${escapeLike(term)}%`;
      params.push(pattern, pattern, pattern, pattern);
      parts.push(negated ? `NOT ${like}` : like);
    }
    if (parts.length === 0) continue;
    groupSql.push(parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`);
  }

  if (groupSql.length === 0) return { joins: "", where: "1=1", params: [] };
  const where = groupSql.length === 1 ? groupSql[0] : `(${groupSql.join(" OR ")})`;
  return { joins: "", where, params };
}
