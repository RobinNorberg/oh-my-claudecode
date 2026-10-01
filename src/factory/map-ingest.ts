/**
 * Wayfinder map ingestion (spec #51, ticket T-B).
 *
 * The single module that talks to the tracker for map-driven ralph runs. Every
 * read funnels through here; the decision logic lives in the pure enumerator
 * (map-frontier). A future non-GitHub tracker would replace this module and
 * nothing else.
 *
 * Reads use the `gh` CLI — the same mechanism the factory chain's tracker
 * writeback already uses — and are injectable so the module is testable without
 * a network.
 */

import { spawnSync } from 'child_process';
import {
  enumerateFrontier,
  type Frontier,
  type FrontierTicket,
  type TicketRecord,
} from './map-frontier.js';

export interface GhRunner {
  (args: string[]): { status: number | null; stdout: string; stderr: string };
}

export const defaultGhRunner: GhRunner = (args) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

export interface MapRef {
  repo: string;
  number: number;
}

/** Parse `owner/repo#46` (repo optional — defaults to the current repository's origin). */
export function parseMapRef(raw: string, fallbackRepo?: string): MapRef | null {
  const match = /^(?:([^/\s#]+)\/([^/\s#]+))?#?(\d+)$/.exec(raw.trim());
  if (!match) return null;
  const repo = match[1] && match[2] ? `${match[1]}/${match[2]}` : fallbackRepo;
  if (!repo) return null;
  return { repo, number: Number(match[3]) };
}

interface GhIssueView {
  number: number;
  state: string;
  labels?: Array<{ name?: string } | string>;
  assignees?: unknown[];
  body?: string;
  parent?: { number?: number } | null;
  blockedBy?: { nodes?: Array<{ number?: number; state?: string }> } | null;
}

function normalizeView(view: GhIssueView): TicketRecord {
  const labels = (view.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name ?? '')).filter(Boolean);
  return {
    number: view.number,
    state: view.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    labels,
    assignees: view.assignees?.length ?? 0,
    body: view.body ?? '',
    nativeParent: view.parent?.number ?? null,
    nativeBlockedBy: (view.blockedBy?.nodes ?? []).map((node) => node.number).filter((n): n is number => typeof n === 'number'),
  };
}

const VIEW_FIELDS = 'number,state,labels,assignees,body,parent,blockedBy';

/**
 * Load every record the frontier computation needs: the map's children
 * candidates (found by body search — the relation that works on live maps),
 * plus any issue referenced as a blocker so its state resolves. An unreadable
 * issue is skipped; the enumerator treats an unknown blocker as open (safe).
 */
export function loadMapRecords(ref: MapRef, gh: GhRunner = defaultGhRunner): TicketRecord[] {
  const seen = new Map<number, TicketRecord>();

  const list = gh(['issue', 'list', '--repo', ref.repo, '--state', 'all', '--limit', '200', '--search', `${ref.number} in:body`, '--json', 'number,state,labels,assignees,body']);
  const candidates: GhIssueView[] = list.status === 0 ? safeJson<GhIssueView[]>(list.stdout, []) : [];
  // The map itself is not a child but references may resolve to it.
  const mapView = gh(['issue', 'view', String(ref.number), '--repo', ref.repo, '--json', VIEW_FIELDS]);
  const views: GhIssueView[] = [...candidates];
  if (mapView.status === 0) {
    const parsed = safeJson<GhIssueView | null>(mapView.stdout, null);
    if (parsed) views.push(parsed);
  }

  // Pull native relations for candidates (list --json does not carry them),
  // then chase every body-named reference for blocker states.
  const refsToView = new Set<number>(views.map((view) => view.number));
  for (const view of views) {
    const detail = gh(['issue', 'view', String(view.number), '--repo', ref.repo, '--json', VIEW_FIELDS]);
    if (detail.status !== 0) continue;
    const parsed = safeJson<GhIssueView | null>(detail.stdout, null);
    if (parsed) seen.set(parsed.number, normalizeView(parsed));
  }
  for (const record of [...seen.values()]) {
    for (const referenced of bodyIssueRefs(record.body)) {
      if (!refsToView.has(referenced)) refsToView.add(referenced);
    }
  }
  for (const number of refsToView) {
    if (seen.has(number)) continue;
    const detail = gh(['issue', 'view', String(number), '--repo', ref.repo, '--json', VIEW_FIELDS]);
    if (detail.status !== 0) continue;
    const parsed = safeJson<GhIssueView | null>(detail.stdout, null);
    if (parsed) seen.set(parsed.number, normalizeView(parsed));
  }
  return [...seen.values()];
}

function bodyIssueRefs(body: string): number[] {
  return [...body.matchAll(/#(\d+)|\/issues\/(\d+)/g)].map((match) => Number(match[1] ?? match[2]));
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export interface PlannedTicket {
  number: number;
  gateClass: 'auto' | 'human';
  /** auto only: ingest with these criteria, or draft first and stop for acceptance. */
  disposition: 'ingest-with-criteria' | 'draft-criteria-then-stop';
  awaitingHuman: boolean;
  malformedEdge: boolean;
}

export interface MapPlan {
  map: MapRef;
  planned: PlannedTicket[];
  frontier: Frontier;
}

/** The plan a dry run prints and a real run acts on: the enumerator's verdict, classified. */
export function planFromMap(ref: MapRef, records: readonly TicketRecord[]): MapPlan {
  const frontier = enumerateFrontier(ref.number, records);
  const classify = (ticket: FrontierTicket): PlannedTicket => ({
    number: ticket.number,
    gateClass: ticket.gateClass,
    disposition: ticket.gateClass === 'auto'
      ? (ticket.hasCriteria ? 'ingest-with-criteria' : 'draft-criteria-then-stop')
      : 'ingest-with-criteria',
    awaitingHuman: ticket.awaitingHuman,
    malformedEdge: ticket.malformedEdge,
  });
  return {
    map: ref,
    frontier,
    planned: [...frontier.auto.map(classify), ...frontier.human.map(classify)],
  };
}

export function renderMapPlan(plan: MapPlan): string {
  const lines: string[] = [];
  lines.push(`map ${plan.map.repo}#${plan.map.number} — frontier plan (dry run, nothing written)`);
  const auto = plan.planned.filter((t) => t.gateClass === 'auto');
  const human = plan.planned.filter((t) => t.gateClass === 'human');
  lines.push(`auto-executable (${auto.length}):`);
  if (auto.length === 0) lines.push('  (none)');
  for (const ticket of auto) {
    lines.push(`  #${ticket.number} — ${ticket.disposition}${ticket.malformedEdge ? ' [malformed edge — human-gated for safety]' : ''}`);
  }
  lines.push(`human-gated (${human.length}):`);
  if (human.length === 0) lines.push('  (none)');
  for (const ticket of human) {
    lines.push(`  #${ticket.number}${ticket.awaitingHuman ? ' — already awaiting human' : ' — routes to human, never auto-claimed'}${ticket.malformedEdge ? ' [malformed edge]' : ''}`);
  }
  if (plan.frontier.malformedEdges.length > 0) {
    lines.push(`malformed edges (safe direction, not auto-runnable): ${plan.frontier.malformedEdges.map((n) => `#${n}`).join(', ')}`);
  }
  return lines.join('\n');
}