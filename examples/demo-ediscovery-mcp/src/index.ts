/**
 * `@maverick/demo-ediscovery-mcp` — Phase 6.
 *
 * MCP server exposing the eDiscovery review + search toolset to
 * analyst workstations (Claude Desktop, Cursor, Zed). Mounts via
 * stdio so paralegals can run privilege review from their IDE
 * without opening the web app — same handlers, same audit trail,
 * same governance.
 *
 * @example Claude Desktop config
 * ```jsonc
 * // ~/Library/Application Support/Claude/claude_desktop_config.json
 * {
 *   "mcpServers": {
 *     "maverick-ediscovery": {
 *       "command": "/abs/path/to/node",
 *       "args": ["/abs/path/to/agentic-ui/examples/demo-ediscovery-mcp/dist/index.js"],
 *       "env": {
 *         "MVK_USER": "paralegal-1",
 *         "MVK_MATTER": "M-2026-0042"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * After restarting Claude Desktop, type prompts like:
 *   - "Search for documents about Project Phoenix"
 *   - "Mark DOC-7891236 as attorney-client privileged — reviewer note: SEC inquiry memo"
 *   - "Run TAR classification on the unreviewed set for topic Project Phoenix"
 *
 * Document previews render as MCP-UI HTML cards (text/html;profile=mcp-app).
 *
 * @remarks
 * **Why we don't import `agenticTool` from `@maverick/agentic-ui`.**
 * That barrel pulls Angular's static initialisers, fatal in a pure-Node
 * MCP host. We build `ToolDef` literals directly. Type-only imports
 * are erased at compile time and stay safe.
 *
 * **Audit trail.** Every tool call writes through the shared package's
 * `appendAudit` which auto-stamps the chain hash. Phase 5's chain-of-
 * custody report can later replay events emitted from this MCP server.
 */
import { createMcpServer } from '@maverick/agentic-ui-mcp';
import type { ToolDef, ToolResultRenderHints } from '@maverick/agentic-ui';
import {
  appendAudit,
  classifyDocuments,
  getDocument,
  isoNow,
  listCustodians,
  listDocuments,
  nextAuditId,
  searchDocuments,
  semanticRank,
  updateDocument,
  type Document,
  type DocumentTag,
  type SemanticHit,
  type TARScore,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';

const MATTER_ID = process.env['MVK_MATTER'] ?? 'M-2026-0042';
const ACTOR     = process.env['MVK_USER']   ?? 'paralegal@firm.example';
const TAGS = ['responsive', 'non-responsive', 'privileged', 'hot', 'redact', 'review-needed'] as const;
const PRIV_REASONS = ['attorney-client', 'work-product', 'common-interest'] as const;

// ── 1. searchDocuments ─────────────────────────────────────────────────────

const searchDocumentsTool: ToolDef = {
  name: 'searchDocuments',
  description:
    'Search documents in the active matter by free-text query, custodians, ' +
    'or tags. Returns up to 25 matching documents with content snippets and ' +
    'renders an HTML preview card for each. Use before tagging or privilege-' +
    'marking when the user gives names or topics rather than document ids.',
  schema: z.object({
    query: z.string().describe('Free-text query against content + filename + author. Pass "" to match all.'),
    custodianIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  handler: async (args) => {
    const { query, custodianIds, tags, limit } = args as {
      query: string; custodianIds?: string[]; tags?: string[]; limit?: number;
    };
    const docs = searchDocuments(MATTER_ID, query, { custodianIds, tags, limit });
    const result: ToolResultRenderHints & {
      query: string; count: number; documents: Array<Pick<Document, 'id' | 'fileName' | 'custodianId' | 'tags' | 'authoredBy' | 'authoredAt' | 'privilegeReason'>>;
    } = {
      query,
      count: docs.length,
      documents: docs.map((d) => ({
        id: d.id, fileName: d.fileName, custodianId: d.custodianId,
        tags: d.tags, authoredBy: d.authoredBy, authoredAt: d.authoredAt,
        privilegeReason: d.privilegeReason,
      })),
      html: renderSearchResultsHtml(query, docs),
      markdown: docs.length === 0
        ? `No documents matched **${query || '(no query)'}**.`
        : `Found **${docs.length}** document(s)${query ? ` for "${query}"` : ''}:\n\n` +
          docs.map((d) =>
            `- \`${d.id}\` — ${d.fileName} · _${d.tags.join(', ') || 'no tags'}_`
          ).join('\n'),
    };
    return result;
  },
};

// ── 2. tagDocument ─────────────────────────────────────────────────────────

const tagDocumentTool: ToolDef = {
  name: 'tagDocument',
  description:
    'Apply (default) or remove tags on a document. Tags: responsive, ' +
    'non-responsive, privileged, hot, redact, review-needed. Audit-logged.',
  schema: z.object({
    documentId: z.string(),
    tags: z.array(z.enum(TAGS)).min(1),
    operation: z.enum(['add', 'remove']).optional(),
  }),
  handler: async (args) => {
    const { documentId, tags, operation } = args as { documentId: string; tags: DocumentTag[]; operation?: 'add' | 'remove' };
    const op = operation ?? 'add';
    const doc = getDocument(documentId);
    if (!doc) {
      return {
        error: `Unknown document: ${documentId}`,
        markdown: `⚠️ No document with id \`${documentId}\`. Try \`searchDocuments\` first.`,
      };
    }
    const before = [...doc.tags];
    const next = op === 'add'
      ? Array.from(new Set([...doc.tags, ...tags]))
      : doc.tags.filter((t) => !tags.includes(t));
    updateDocument(documentId, { tags: next as readonly DocumentTag[] });
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: op === 'add' ? 'document.tag.added' : 'document.tag.removed',
      target: { type: 'document', id: documentId },
      before: { tags: before },
      after: { tags: next },
    });
    const updated = getDocument(documentId)!;
    return {
      documentId, operation: op, tags: next,
      html: renderDocumentCardHtml(updated),
      markdown:
        `**${op === 'add' ? 'Tags added' : 'Tags removed'}** on \`${documentId}\`: ` +
        tags.map((t) => `\`${t}\``).join(', ') +
        `\n\nCurrent tags: ${next.length === 0 ? '_(none)_' : next.map((t) => `\`${t}\``).join(', ')}`,
    };
  },
};

// ── 3. markPrivileged ──────────────────────────────────────────────────────

const markPrivilegedTool: ToolDef = {
  name: 'markPrivileged',
  description:
    'Flag a document as privileged with a basis (attorney-client / work-product / ' +
    'common-interest). Sets privilegeReason and adds the privileged tag. ' +
    'NEVER call without confirming the basis matches the document content.',
  schema: z.object({
    documentId: z.string(),
    reason: z.enum(PRIV_REASONS),
    note: z.string().optional(),
  }),
  handler: async (args) => {
    const { documentId, reason, note } = args as { documentId: string; reason: typeof PRIV_REASONS[number]; note?: string };
    const doc = getDocument(documentId);
    if (!doc) {
      return {
        error: `Unknown document: ${documentId}`,
        markdown: `⚠️ No document with id \`${documentId}\`. Search first.`,
      };
    }
    const before = { tags: [...doc.tags], privilegeReason: doc.privilegeReason };
    const tagsNext = doc.tags.includes('privileged')
      ? doc.tags
      : ([...doc.tags, 'privileged'] as readonly DocumentTag[]);
    updateDocument(documentId, { tags: tagsNext, privilegeReason: reason });
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'document.marked-privileged',
      target: { type: 'document', id: documentId },
      before,
      after: { tags: tagsNext, privilegeReason: reason },
      reason: note,
    });
    const updated = getDocument(documentId)!;
    return {
      documentId, privilegeReason: reason,
      html: renderDocumentCardHtml(updated),
      markdown:
        `**Marked privileged** — \`${documentId}\` (${reason})` +
        (note ? `\n\n> ${note}` : ''),
    };
  },
};

// ── 4. addToPrivilegeLog ───────────────────────────────────────────────────

const addToPrivilegeLogTool: ToolDef = {
  name: 'addToPrivilegeLog',
  description:
    'Append a privilege-log entry to the matter audit trail summarising ' +
    'every currently-privileged document (or just one if documentId is given).',
  schema: z.object({
    documentId: z.string().optional(),
    summary: z.string().min(5),
  }),
  handler: async (args) => {
    const { documentId, summary } = args as { documentId?: string; summary: string };
    const candidates = documentId
      ? [getDocument(documentId)].filter((d): d is NonNullable<typeof d> => Boolean(d))
      : listDocuments(MATTER_ID).filter((d) => d.privilegeReason);
    if (candidates.length === 0) {
      return {
        markdown: documentId
          ? `⚠️ Document \`${documentId}\` not found.`
          : 'No privileged documents on this matter yet — nothing to log.',
        count: 0,
      };
    }
    const entry = {
      summary,
      documents: candidates.map((d) => ({
        id: d.id, fileName: d.fileName, custodianId: d.custodianId,
        privilegeReason: d.privilegeReason ?? 'unspecified',
      })),
    };
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'privilege-log.entry.added',
      target: documentId
        ? { type: 'document', id: documentId }
        : { type: 'matter', id: MATTER_ID },
      after: entry,
      reason: summary,
    });
    return {
      ...entry,
      count: candidates.length,
      markdown:
        `**Privilege-log entry added** — ${candidates.length} document(s)\n\n` +
        candidates.map((d) =>
          `- \`${d.id}\` — ${d.fileName} (${d.privilegeReason ?? 'unspecified'})`
        ).join('\n') +
        `\n\n> ${summary}`,
    };
  },
};

// ── 5. runTARClassifier ────────────────────────────────────────────────────

const runTARClassifierTool: ToolDef = {
  name: 'runTARClassifier',
  description:
    'Score the un-tagged document set against a topic via TAR (Technology- ' +
    'Assisted Review). Returns per-document confidence for `responsive`, ' +
    '`privileged`, and `hot`. Used to prioritise the next slice of review.',
  schema: z.object({
    topic: z.string().min(3),
    onlyUntagged: z.boolean().optional(),
    threshold: z.number().min(0).max(1).optional(),
  }),
  handler: async (args) => {
    const { topic, onlyUntagged, threshold } = args as { topic: string; onlyUntagged?: boolean; threshold?: number };
    const onlyU = onlyUntagged ?? true;
    const cutoff = threshold ?? 0.3;
    const target = onlyU
      ? listDocuments(MATTER_ID).filter((d) => d.tags.length === 0)
      : listDocuments(MATTER_ID);
    const scores = classifyDocuments(target, topic);
    const above = scores.filter((s) =>
      s.responsive >= cutoff || s.privileged >= cutoff || s.hot >= cutoff,
    ).sort((a, b) =>
      Math.max(b.responsive, b.privileged, b.hot)
      - Math.max(a.responsive, a.privileged, a.hot),
    );
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'tar.classified',
      target: { type: 'matter', id: MATTER_ID },
      after: { topic, scored: scores.length, aboveThreshold: above.length, threshold: cutoff },
    });
    return {
      topic, scored: scores.length, aboveThreshold: above.length, threshold: cutoff,
      scores: above.slice(0, 25).map((s) => ({
        documentId: s.documentId,
        responsive: Number(s.responsive.toFixed(3)),
        privileged: Number(s.privileged.toFixed(3)),
        hot: Number(s.hot.toFixed(3)),
        rationale: s.rationale,
      })),
      html: renderTARScoresHtml(topic, cutoff, scores.length, above),
      markdown:
        `**TAR run** — topic "${topic}" · scored **${scores.length}** doc(s) · ` +
        `**${above.length}** above \`${cutoff}\`\n\n` +
        (above.length === 0
          ? '_No documents scored above the threshold._'
          : above.slice(0, 6).map(formatTarRow).join('\n')),
    };
  },
};

// ── HTML render helpers ────────────────────────────────────────────────────

function renderSearchResultsHtml(query: string, docs: readonly Document[]): string {
  const custMap = new Map(listCustodians(MATTER_ID).map((c) => [c.id, c.name]));
  const rows = docs.slice(0, 8).map((d) => `
    <article style="padding:0.7rem 0.9rem;border:1px solid #d1d5db;border-radius:0.5rem;background:#fff;margin-top:0.5rem;border-left:4px solid ${d.privilegeReason ? '#b91c1c' : '#6366f1'};">
      <header style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-bottom:0.4rem;">
        <span style="font-size:0.65em;padding:2px 6px;border-radius:4px;background:#e0e7ff;color:#3730a3;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">document</span>
        <strong style="color:#0f172a;font-size:0.95em;">${escapeHtml(d.fileName)}</strong>
        ${d.privilegeReason ? `<span style="margin-left:auto;font-size:0.7em;padding:1px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:600;">${escapeHtml(d.privilegeReason)}</span>` : ''}
      </header>
      <p style="margin:0.3rem 0;color:#475569;font-size:0.82em;">
        <strong>${escapeHtml(custMap.get(d.custodianId) ?? d.custodianId)}</strong>
        · ${escapeHtml(d.authoredBy ?? '—')}
        · ${escapeHtml(d.authoredAt?.slice(0, 10) ?? '—')}
      </p>
      <p style="margin:0.3rem 0;color:#334155;font-size:0.85em;line-height:1.4;background:#f8fafc;padding:0.4rem 0.6rem;border-radius:4px;">
        ${escapeHtml(snippetPreview(d.contentSnippet))}
      </p>
      <footer style="margin-top:0.4rem;display:flex;gap:0.3rem;flex-wrap:wrap;">
        <code style="font-size:0.78em;color:#64748b;background:#f1f5f9;padding:1px 6px;border-radius:3px;">${escapeHtml(d.id)}</code>
        ${d.tags.map(tagPillHtml).join('')}
      </footer>
    </article>`).join('');
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f7f7f5;">
  <header style="display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.5rem;">
    <span style="font-size:0.7em;padding:2px 8px;border-radius:4px;background:#e0e7ff;color:#3730a3;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">search</span>
    <strong style="font-size:1rem;color:#0f172a;">${docs.length} hit(s)</strong>
    <em style="margin-left:auto;color:#64748b;font-size:0.85em;">"${escapeHtml(query)}"</em>
  </header>
  ${rows || '<p style="color:#94a3b8;text-align:center;padding:1rem;">No documents matched.</p>'}
</body></html>`.trim();
}

function renderDocumentCardHtml(d: Document): string {
  const custName = listCustodians(MATTER_ID).find((c) => c.id === d.custodianId)?.name ?? d.custodianId;
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f7f7f5;">
  <article style="padding:0.8rem 1rem;border:1px solid #d1d5db;border-radius:0.6rem;background:#fff;border-left:4px solid ${d.privilegeReason ? '#b91c1c' : '#6366f1'};max-width:560px;">
    <header style="display:flex;gap:0.5rem;align-items:baseline;flex-wrap:wrap;margin-bottom:0.5rem;">
      <span style="font-size:0.65em;padding:2px 6px;border-radius:4px;background:#e0e7ff;color:#3730a3;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">document</span>
      <strong style="font-size:1rem;color:#0f172a;">${escapeHtml(d.fileName)}</strong>
      ${d.privilegeReason ? `<span style="margin-left:auto;font-size:0.7em;padding:2px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:600;">${escapeHtml(d.privilegeReason)}</span>` : ''}
    </header>
    <dl style="margin:0.5rem 0;display:grid;grid-template-columns:auto 1fr;gap:0.2rem 0.7rem;font-size:0.82em;">
      <dt style="color:#64748b;">ID</dt>           <dd style="margin:0;"><code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;">${escapeHtml(d.id)}</code></dd>
      <dt style="color:#64748b;">Custodian</dt>    <dd style="margin:0;color:#0f172a;">${escapeHtml(custName)} <small style="color:#94a3b8;">(${escapeHtml(d.custodianId)})</small></dd>
      <dt style="color:#64748b;">Author</dt>       <dd style="margin:0;">${escapeHtml(d.authoredBy ?? '—')}</dd>
      <dt style="color:#64748b;">Authored</dt>     <dd style="margin:0;">${escapeHtml(d.authoredAt ?? '—')}</dd>
      <dt style="color:#64748b;">SHA-256</dt>      <dd style="margin:0;"><code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:0.92em;">${escapeHtml(d.hash)}</code></dd>
    </dl>
    <p style="margin:0.5rem 0;background:#f8fafc;padding:0.5rem 0.7rem;border-radius:4px;font-size:0.85em;line-height:1.45;color:#334155;">
      ${escapeHtml(snippetPreview(d.contentSnippet, 320))}
    </p>
    <footer style="margin-top:0.5rem;display:flex;gap:0.3rem;flex-wrap:wrap;">
      ${d.tags.length === 0 ? '<small style="color:#94a3b8;">no tags</small>' : d.tags.map(tagPillHtml).join('')}
    </footer>
  </article>
</body></html>`.trim();
}

function renderTARScoresHtml(topic: string, threshold: number, scored: number, rows: readonly TARScore[]): string {
  const body = rows.slice(0, 12).map((r) => `
    <tr>
      <td style="padding:0.35rem 0.5rem;font-family:ui-monospace,monospace;font-size:0.85em;color:#475569;border-bottom:1px solid #f1f5f9;">${escapeHtml(r.documentId)}</td>
      <td style="padding:0.35rem 0.5rem;border-bottom:1px solid #f1f5f9;">${scoreBarHtml(r.responsive, '#059669')}</td>
      <td style="padding:0.35rem 0.5rem;border-bottom:1px solid #f1f5f9;">${scoreBarHtml(r.privileged, '#dc2626')}</td>
      <td style="padding:0.35rem 0.5rem;border-bottom:1px solid #f1f5f9;">${scoreBarHtml(r.hot, '#d97706')}</td>
      <td style="padding:0.35rem 0.5rem;border-bottom:1px solid #f1f5f9;font-size:0.8em;color:#64748b;font-style:italic;">${escapeHtml(r.rationale)}</td>
    </tr>`).join('');
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f7f7f5;">
  <article style="padding:0.8rem 1rem;border:1px solid #d1d5db;border-radius:0.6rem;background:#fff;border-left:4px solid #0284c7;">
    <header style="display:flex;gap:0.5rem;align-items:baseline;flex-wrap:wrap;margin-bottom:0.5rem;">
      <span style="font-size:0.65em;padding:2px 6px;border-radius:4px;background:#dbeafe;color:#1e40af;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">TAR</span>
      <strong style="color:#0f172a;font-size:1rem;">${escapeHtml(topic)}</strong>
      <span style="margin-left:auto;color:#64748b;font-size:0.78em;">${scored} scored · threshold ≥ ${threshold}</span>
    </header>
    <table style="width:100%;border-collapse:collapse;font-size:0.85em;">
      <thead>
        <tr style="background:#f7f7f5;">
          <th style="padding:0.35rem 0.5rem;text-align:left;font-size:0.65em;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:500;">Document</th>
          <th style="padding:0.35rem 0.5rem;text-align:left;font-size:0.65em;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:500;">Responsive</th>
          <th style="padding:0.35rem 0.5rem;text-align:left;font-size:0.65em;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:500;">Privileged</th>
          <th style="padding:0.35rem 0.5rem;text-align:left;font-size:0.65em;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:500;">Hot</th>
          <th style="padding:0.35rem 0.5rem;text-align:left;font-size:0.65em;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;font-weight:500;">Rationale</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </article>
</body></html>`.trim();
}

function tagPillHtml(t: string): string {
  const palette: Record<string, [string, string]> = {
    'responsive':     ['#d1fae5', '#065f46'],
    'non-responsive': ['#f8fafc', '#94a3b8'],
    'privileged':     ['#fee2e2', '#991b1b'],
    'hot':            ['#fef3c7', '#92400e'],
    'redact':         ['#ede9fe', '#7c3aed'],
    'review-needed':  ['#f1f5f9', '#475569'],
  };
  const [bg, fg] = palette[t] ?? ['#f1f5f9', '#475569'];
  return `<span style="font-size:0.7em;padding:1px 8px;border-radius:999px;background:${bg};color:${fg};font-weight:500;">${escapeHtml(t)}</span>`;
}

function scoreBarHtml(score: number, color: string): string {
  const pct = Math.round(score * 100);
  return `
    <span style="display:inline-flex;align-items:center;gap:0.35rem;">
      <span style="display:inline-block;width:60px;height:5px;background:#e2e8f0;border-radius:999px;overflow:hidden;">
        <span style="display:block;height:100%;width:${pct}%;background:${color};border-radius:999px;"></span>
      </span>
      <span style="font-variant-numeric:tabular-nums;font-size:0.85em;color:#475569;min-width:30px;">${pct}%</span>
    </span>`;
}

function snippetPreview(s: string, max = 200): string {
  const clean = s.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function formatTarRow(s: TARScore): string {
  return `\`${s.documentId}\` · resp \`${s.responsive.toFixed(2)}\` · ` +
    `priv \`${s.privileged.toFixed(2)}\` · hot \`${s.hot.toFixed(2)}\` · _${s.rationale}_`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

// Reference imports kept honest by the typechecker — used via type narrowing above.
void ([] as SemanticHit[]);
void semanticRank;

// ── Wire the MCP server ────────────────────────────────────────────────────

const handle = createMcpServer({
  name: 'maverick-ediscovery',
  version: '0.1.0',
  tools: [
    searchDocumentsTool,
    tagDocumentTool,
    markPrivilegedTool,
    addToPrivilegeLogTool,
    runTARClassifierTool,
  ],
  /**
   * Stub authentication / per-user audit attribution.
   *
   * The real per-user MCP server pattern from the cookbook:
   *  - Spawn one MCP server per user, identified by the env var below.
   *  - Each server's `appendAudit` calls carry the user id as actor.
   *  - The matter id can also be scoped per server instance, letting
   *    different paralegals work different matters from the same
   *    Claude Desktop config.
   */
  beforeCall: ({ name, callId }) => {
    console.error(`[mcp] ${callId} → ${name}  user=${ACTOR}  matter=${MATTER_ID}`);
  },
  afterCall: ({ name, callId, durationMs, ok }) => {
    console.error(`[mcp] ${callId} ← ${name}  ${durationMs}ms  ${ok ? 'ok' : 'failed'}`);
  },
});

await handle.startStdio();
console.error(`[mcp] maverick-ediscovery MCP server connected over stdio  (matter=${MATTER_ID}, user=${ACTOR})`);
