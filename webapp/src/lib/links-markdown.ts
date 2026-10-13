// Minimal Markdown renderer for Links notes.
// HTML-escape first, then **bold**, *italic*, `code`, [text](http(s)://…)
// and paragraph/line breaks. URLs restricted to http/https.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(src: string): string {
  let out = escapeHtml(src);
  out = out.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\W)\*([^*\n]+?)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+?)\]\((https?:\/\/[^)\s]+?)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return out;
}

export function renderLinksMarkdown(md: string): string {
  const input = String(md ?? "");
  const lines = input.split("\n");
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push(`<p>${para.map(renderInline).join("<br/>")}</p>`);
      para = [];
    }
  };
  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks.join("\n");
}
