// Pure (no @forge) parser for a phase-story "Checklist Text" field (customfield_10051).
//
// The field can be stored in TWO ADF shapes and both must parse identically:
//   (a) flat paragraphs — what provision.js writes: a "# Name" paragraph, then one
//       "[open] item" paragraph per item (optionally bullet-prefixed).
//   (b) Gebsun / "Checklist for Jira Pro" NORMALISED shape — an orderedList holding the
//       "Name" header, followed by a bulletList whose items are plain "[done] text".
// Shape (b) is what the checklist app rewrites the field into; the old parser only read
// shape (a) (top-level text/hardBreak), so a normalised field parsed to [] and the
// dashboard fell back to the static framework list at 0%. This reads both.
//
// Only the FIRST (native) block is returned; later blocks — user lists, the QA-rework
// automation's "QA Rework N" blocks — are intentionally ignored (they belong on the
// ticket + tree view, not in the phase % / side-panel checklist).

// Flatten a node's visible text; a hardBreak becomes a newline so multi-line paragraphs split.
export function nodeText(node) {
  let s = '';
  for (const n of (node.content || [])) {
    if (n.type === 'text') s += n.text || '';
    else if (n.type === 'hardBreak') s += '\n';
    else if (n.content) s += nodeText(n);
  }
  return s;
}

// Turn an ADF doc into tagged lines { text, header }. An orderedList item, a `heading`
// node, or a `#`-prefixed line is a HEADER (Gebsun renders the "# Name" header as an
// ordered list); bulletList items and plain paragraphs are content lines.
export function toLines(adf) {
  const lines = [];
  for (const block of (adf.content || [])) {
    if (block.type === 'orderedList' || block.type === 'bulletList') {
      const header = block.type === 'orderedList';
      for (const li of (block.content || [])) {
        for (const t of nodeText(li).split('\n')) lines.push({ text: t, header });
      }
    } else {
      const heading = block.type === 'heading';
      for (const t of nodeText(block).split('\n')) lines.push({ text: t, header: heading });
    }
  }
  return lines;
}

export function parseChecklist(adf) {
  if (!adf || !adf.content) return [];
  const items = [];
  let headers = 0, leadHeader = null;
  for (let { text, header } of toLines(adf)) {
    text = text.replace(/​/g, '').trim();
    if (!text) continue;
    const isHeader = header || text.startsWith('#');
    if (leadHeader === null) leadHeader = isHeader;
    if (isHeader) { headers += 1; continue; }
    if (headers >= (leadHeader ? 2 : 1)) break; // past the first (native) block
    // a ">>" line (optionally bullet-prefixed) is a team annotation / comment on the item
    // above it — NOT its own checklist row. Skip it so it doesn't show as a separate item
    // (it stays on the Jira ticket). Only the phase checklist filters these; the rework /
    // defect parsers keep them, where the ">>" explanations are the defect notes.
    if (/^[*+-]?\s*>>/.test(text)) continue;
    // bullet prefix is OPTIONAL — normalised list items carry no "* " in their text
    const m = text.match(/^[*+-]?\s*\[([^\]]*)\]\s*(.*)$/);
    if (m) { const st = m[1].trim().toLowerCase(); items.push({ text: m[2].trim(), done: st === 'complete' || st === 'done' || st === 'x' }); }
    else items.push({ text: text.replace(/^[*+-]\s*/, '').trim(), done: false });
  }
  return items;
}
