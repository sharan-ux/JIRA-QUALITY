// Pure ADF helpers for the QA rework loop. No Forge/Jira imports — unit-testable.
// CommonJS so `node --test` runs it directly without a build step.

const HEADER_RE = /^#\s+(.+)$/;
const ITEM_RE = /^\s*(?:[*+-]\s*)?\[([^\]]*)\]\s*(.*)$/;
const NOTE_SEP = ' · 📝 ';
const ZWSP = /​/g;
const STAMP_RE = /^QA Failed (\d+)$/i;

function textLines(adf) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'text' && typeof node.text === 'string') out.push({ text: node.text, node });
    if (node.content) walk(node.content);
  };
  walk(adf && adf.content);
  return out;
}

/** Extract the concatenated text content of a top-level ADF node (single pass). */
function nodeText(node) {
  const parts = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    if (n.content) walk(n.content);
  };
  walk(node.content);
  return parts.join('').replace(ZWSP, '');
}

/**
 * Parse an ADF doc into header/items blocks.
 *
 * Handles TWO forms (both must produce identical output):
 *
 * OLD (paragraph-based, written by blockParagraphs):
 *   paragraph → text "# Header"
 *   paragraph → text "[open] item text"
 *
 * NEW (Gebsun-normalised, returned by cf10051 after Checklist for Jira Pro processes):
 *   orderedList (attrs.order=1) → listItem → paragraph → text "Header" (NO leading #)
 *   bulletList  → listItem → paragraph → text "[open] item text"
 *
 * Returns Block[] where Block = { header: string, items: {text, done, node}[] }
 */
function parseBlocks(adf) {
  if (!adf || !Array.isArray(adf.content)) return [];
  const blocks = [];
  let cur = null;

  for (const topNode of adf.content) {
    if (!topNode) continue;
    const type = topNode.type;

    // --- Gebsun form: orderedList → header ---
    if (type === 'orderedList') {
      const raw = nodeText(topNode).trim();
      // Strip a leading "# " if Gebsun ever preserves it (defensive)
      const headerName = raw.replace(/^#\s+/, '');
      cur = { header: headerName, items: [] };
      blocks.push(cur);
      continue;
    }

    // --- Gebsun form: bulletList → items ---
    if (type === 'bulletList') {
      if (!cur) continue; // orphan bullet list — skip
      const liNodes = topNode.content || [];
      for (const li of liNodes) {
        const raw = nodeText(li).replace(ZWSP, '');
        const m = raw.match(ITEM_RE);
        if (!m) continue;
        // find the deepest text node for the mutation reference
        let textNode = null;
        const findText = (n) => {
          if (!n) return;
          if (Array.isArray(n)) { n.forEach(findText); return; }
          if (n.type === 'text' && typeof n.text === 'string' && !textNode) textNode = n;
          if (n.content) findText(n.content);
        };
        findText(li);
        const state = m[1].trim().toLowerCase();
        cur.items.push({ text: m[2].split(NOTE_SEP)[0].trim(), done: state === 'done' || state === 'x', node: textNode });
      }
      continue;
    }

    // --- OLD paragraph-based form (and any other text-bearing node) ---
    const lines = textLines({ content: [topNode] });
    for (const { text, node } of lines) {
      const clean = text.replace(ZWSP, '');
      const h = clean.match(HEADER_RE);
      if (h) { cur = { header: h[1].trim(), items: [] }; blocks.push(cur); continue; }
      const m = clean.match(ITEM_RE);
      if (m && cur) {
        const state = m[1].trim().toLowerCase();
        cur.items.push({ text: m[2].split(NOTE_SEP)[0].trim(), done: state === 'done' || state === 'x', node });
      }
    }
  }

  return blocks;
}

function currentRoundItems(adf, phaseName) {
  const seen = new Set(); const out = [];
  for (const b of parseBlocks(adf)) {
    if (b.header === phaseName || STAMP_RE.test(b.header)) continue;
    for (const it of b.items) { if (!seen.has(it.text)) { seen.add(it.text); out.push(it.text); } }
  }
  return out;
}

function priorRounds(adf) {
  let max = 0;
  for (const b of parseBlocks(adf)) { const m = b.header.match(STAMP_RE); if (m) max = Math.max(max, +m[1]); }
  return max;
}

function blockParagraphs(header, items) {
  return [`# ${header}`, ...items.map((t) => `[open] ${t}`)]
    .map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }));
}

/**
 * Rename the current-round defect block header to "QA Failed <round>".
 * Skips: the phase block (header === phaseName) and already-stamped blocks.
 * Handles BOTH ADF forms:
 *   - Gebsun form: the top-level node is an orderedList whose first text node holds the header name (NO "# ")
 *   - Old paragraph form: the top-level node is a paragraph whose text node holds "# Header"
 */
function stampQaHeader(adf, phaseName, round) {
  const clone = JSON.parse(JSON.stringify(adf));
  const itemTexts = currentRoundItems(adf, phaseName);

  if (!Array.isArray(clone.content)) return { adf: clone, itemTexts };

  for (const topNode of clone.content) {
    if (!topNode) continue;

    // --- Gebsun form: orderedList ---
    if (topNode.type === 'orderedList') {
      // Find the first text node inside; that holds the header name (no "# ").
      let firstTextNode = null;
      const findFirst = (n) => {
        if (firstTextNode) return;
        if (!n) return;
        if (Array.isArray(n)) { n.forEach(findFirst); return; }
        if (n.type === 'text' && typeof n.text === 'string') { firstTextNode = n; return; }
        if (n.content) findFirst(n.content);
      };
      findFirst(topNode.content);
      if (!firstTextNode) continue;
      const headerName = firstTextNode.text.replace(ZWSP, '').replace(/^#\s+/, '').trim();
      if (headerName === phaseName || STAMP_RE.test(headerName)) continue;
      // Rename: Gebsun form uses plain text (no "# " prefix)
      firstTextNode.text = `QA Failed ${round}`;
      continue;
    }

    // --- Old paragraph form: any text-bearing node with "# Header" ---
    const walkOld = (node) => {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walkOld); return; }
      if (node.type === 'text' && typeof node.text === 'string') {
        const m = node.text.replace(ZWSP, '').match(HEADER_RE);
        if (m) {
          const h = m[1].trim();
          if (h !== phaseName && !STAMP_RE.test(h)) node.text = `# QA Failed ${round}`;
        }
      }
      if (node.content) walkOld(node.content);
    };
    walkOld(topNode);
  }

  return { adf: clone, itemTexts };
}

function appendReworkBlock(devAdf, round, itemTexts) {
  const clone = JSON.parse(JSON.stringify(devAdf));
  clone.content = (clone.content || []).concat(blockParagraphs(`QA Rework ${round}`, itemTexts));
  return clone;
}

function reworkRoundComplete(devAdf, round) {
  const block = parseBlocks(devAdf).find((b) => b.header === `QA Rework ${round}`);
  if (!block || block.items.length === 0) return false;
  return block.items.every((i) => i.done);
}

module.exports = { textLines, parseBlocks, STAMP_RE, currentRoundItems, priorRounds, blockParagraphs, stampQaHeader, appendReworkBlock, reworkRoundComplete };
