import { describe, it, expect } from 'vitest';
import { loadMapRecords, parseMapRef, planFromMap, renderMapPlan, type GhRunner } from '../map-ingest.js';
import { WAYFINDER_TASK_AFK_LABEL, WAYFINDER_AWAITING_HUMAN_LABEL, type TicketRecord } from '../map-frontier.js';

const MAP = { repo: 'o/r', number: 46 };

function ghView(overrides: Record<string, unknown>): string {
  return JSON.stringify({ number: 1, state: 'OPEN', labels: [], assignees: [], body: '', parent: null, blockedBy: { nodes: [] }, ...overrides });
}

/** A fake gh that answers `issue list` and `issue view <n>` from fixtures. */
function fakeGh(views: Record<number, string>, listJson: string): GhRunner {
  return (args) => {
    if (args[0] === 'issue' && args[1] === 'list') return { status: 0, stdout: listJson, stderr: '' };
    if (args[0] === 'issue' && args[1] === 'view') {
      const n = Number(args[2]);
      const body = views[n];
      return body ? { status: 0, stdout: body, stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
    }
    return { status: 1, stdout: '', stderr: 'unsupported' };
  };
}

describe('parseMapRef', () => {
  it('parses owner/repo#46, bare #46 with fallback, and rejects junk', () => {
    expect(parseMapRef('owner/repo#46')).toEqual({ repo: 'owner/repo', number: 46 });
    expect(parseMapRef('#46', 'o/r')).toEqual({ repo: 'o/r', number: 46 });
    expect(parseMapRef('46', 'o/r')).toEqual({ repo: 'o/r', number: 46 });
    expect(parseMapRef('nonsense')).toBeNull();
    expect(parseMapRef('46')).toBeNull();
  });
});

describe('loadMapRecords', () => {
  it('normalizes labels (strings and objects), native parent, and native blocked-by from gh views', () => {
    const gh = fakeGh(
      {
        46: ghView({ labels: [{ name: 'wayfinder:map' }] }),
        50: ghView({ number: 50, labels: ['wayfinder:research', { name: 'agents' }], parent: { number: 46 }, body: '## Acceptance criteria\n\n- [ ] x' }),
        51: ghView({ number: 51, labels: [{ name: 'wayfinder:grilling' }], parent: { number: 46 }, blockedBy: { nodes: [{ number: 50, state: 'OPEN' }] }, body: 'q' }),
      },
      JSON.stringify([
        { number: 50, state: 'OPEN', labels: [{ name: 'wayfinder:research' }], assignees: [], body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)' },
        { number: 51, state: 'OPEN', labels: [{ name: 'wayfinder:grilling' }], assignees: [], body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)' },
      ]),
    );
    const records = loadMapRecords(MAP, gh);
    const byNumber = new Map(records.map((r) => [r.number, r]));
    expect(byNumber.get(50)?.labels).toEqual(['wayfinder:research', 'agents']);
    expect(byNumber.get(50)?.nativeParent).toBe(46);
    expect(byNumber.get(51)?.nativeBlockedBy).toEqual([50]);
  });

  it('chases body-named blockers so their states resolve', () => {
    const gh = fakeGh(
      {
        46: ghView({}),
        60: ghView({ number: 60, labels: ['wayfinder:research'], parent: { number: 46 }, body: '## Blocked by\n\n- [#61](https://github.com/o/r/issues/61)' }),
        61: ghView({ number: 61, state: 'CLOSED', labels: ['wayfinder:research'] }),
      },
      JSON.stringify([{ number: 60, state: 'OPEN', labels: [{ name: 'wayfinder:research' }], assignees: [], body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)' }]),
    );
    const plan = planFromMap(MAP, loadMapRecords(MAP, gh));
    // #61 CLOSED resolves the block → #60 auto-admitted.
    expect(plan.planned.filter((t) => t.gateClass === 'auto').map((t) => t.number)).toEqual([60]);
  });

  it('survives unreadable tracker output without throwing (safe direction downstream)', () => {
    const gh: GhRunner = () => ({ status: 1, stdout: '', stderr: 'boom' });
    expect(() => loadMapRecords(MAP, gh)).not.toThrow();
    const plan = planFromMap(MAP, loadMapRecords(MAP, gh));
    expect(plan.planned).toEqual([]);
  });
});

describe('planFromMap + renderMapPlan', () => {
  const records: TicketRecord[] = [
    { number: 46, state: 'OPEN', labels: ['wayfinder:map'], assignees: 0, body: '' },
    { number: 70, state: 'OPEN', labels: ['wayfinder:research'], assignees: 0, body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)\n\n## Acceptance criteria\n\n- [ ] done', nativeParent: 46 },
    { number: 71, state: 'OPEN', labels: ['wayfinder:task', WAYFINDER_TASK_AFK_LABEL], assignees: 0, body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)\n\nquestion, no criteria', nativeParent: 46 },
    { number: 72, state: 'OPEN', labels: ['wayfinder:grilling', WAYFINDER_AWAITING_HUMAN_LABEL], assignees: 0, body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)\n\nquestion', nativeParent: 46 },
    { number: 73, state: 'OPEN', labels: ['wayfinder:research'], assignees: 0, body: '## Parent\n\n[o/r#46](https://github.com/o/r/issues/46)\n\n## Blocked by\n\n[the design ticket](https://github.com/o/r/issues/not-a-number)', nativeParent: 46 },
  ];

  it('classifies ingest-with-criteria, draft-then-stop, human-routed, and malformed-edge tickets', () => {
    const plan = planFromMap(MAP, records);
    const byNumber = new Map(plan.planned.map((t) => [t.number, t]));
    expect(byNumber.get(70)).toMatchObject({ gateClass: 'auto', disposition: 'ingest-with-criteria' });
    expect(byNumber.get(71)).toMatchObject({ gateClass: 'auto', disposition: 'draft-criteria-then-stop' });
    expect(byNumber.get(72)).toMatchObject({ gateClass: 'human', awaitingHuman: true });
    expect(byNumber.get(73)).toMatchObject({ gateClass: 'human', malformedEdge: true });
    expect(plan.frontier.malformedEdges).toEqual([73]);
  });

  it('renders the split with the no-write statement and the malformed edge section', () => {
    const text = renderMapPlan(planFromMap(MAP, records));
    expect(text).toContain('dry run, nothing written');
    expect(text).toContain('auto-executable (2)');
    expect(text).toContain('#70 — ingest-with-criteria');
    expect(text).toContain('#71 — draft-criteria-then-stop');
    expect(text).toContain('#72 — already awaiting human');
    expect(text).toContain('#73');
    expect(text).toContain('malformed edges (safe direction');
  });
});