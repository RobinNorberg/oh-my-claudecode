import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tmpRoot: null as string | null,
  guardRuntimeUnavailable: false,
  guardCalls: 0,
}));

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, tmpdir: () => mocks.tmpRoot ?? actual.tmpdir() };
});

vi.mock('../runtime-owner-client.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../runtime-owner-client.js')>();
  return {
    ...actual,
    resolveRuntimeCliPath: () => {
      if (mocks.guardRuntimeUnavailable) throw new Error('runtime cli missing');
      return process.execPath;
    },
  };
});

vi.mock('../../cli/tmux-utils.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../cli/tmux-utils.js')>();
  return {
    ...actual,
    // The guarded split reports that the identity guard rejected the server:
    // tmux ran the failure branch, so no pane was created.
    tmuxCmdAsync: async (args: string[]) => {
      if (!args.includes('if-shell')) return { stdout: '', stderr: '' };
      mocks.guardCalls += 1;
      const marker = args.join(' ').match(/OMC_TMUX_GUARD_OK_[A-Za-z0-9_]+/)?.[0] ?? '';
      return { stdout: `OMC_TMUX_GUARD_FAIL_${marker}\n`, stderr: '' };
    },
  };
});

import { splitTeamWorkerPaneWithEvidence } from '../tmux-session.js';
import type { TmuxServerIdentity } from '../types.js';

const identity: TmuxServerIdentity = {
  socket_path: '/tmp/omc-split-pane-env.sock',
  server_pid: process.pid,
  process_started_at: 'linux:split-pane-env:1',
};
const matchingServer = {
  processObservation: () => 'matching' as const,
  processIdentity: () => identity.process_started_at,
  tmuxQuery: async () => ({ stdout: `${identity.server_pid}\n`, stderr: '' }),
};

describe('worker pane env file when a guarded split creates no pane', () => {
  beforeEach(() => {
    mocks.tmpRoot = mkdtempSync(join(tmpdir(), 'omc-split-env-root-'));
    mocks.guardRuntimeUnavailable = false;
    mocks.guardCalls = 0;
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.stubEnv('SHELL', '/bin/bash');
    vi.stubEnv('OMC_TEAM_WORKER_ENV_PASSTHROUGH', 'OMC_SPLIT_ENV_TOKEN');
    vi.stubEnv('OMC_SPLIT_ENV_TOKEN', 'split-env-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (mocks.tmpRoot) rmSync(mocks.tmpRoot, { recursive: true, force: true });
    mocks.tmpRoot = null;
  });

  it('removes the env file when the identity guard rejects the split', async () => {
    const evidence = await splitTeamWorkerPaneWithEvidence(
      '%1', 'right', '/tmp', 'tmux', identity, matchingServer,
    );

    expect(mocks.guardCalls).toBe(1);
    expect(evidence).toMatchObject({ commandSucceeded: false, paneId: null });
    expect(readdirSync(mocks.tmpRoot!)).toEqual([]);
  });

  it('removes the env file when the guarded split throws before running', async () => {
    mocks.guardRuntimeUnavailable = true;

    const evidence = await splitTeamWorkerPaneWithEvidence(
      '%1', 'down', '/tmp', 'tmux', identity, matchingServer,
    );

    expect(mocks.guardCalls).toBe(0);
    expect(evidence).toMatchObject({
      commandSucceeded: false,
      paneId: null,
      stderr: 'tmux_server_guard_runtime_path_unavailable',
    });
    expect(readdirSync(mocks.tmpRoot!)).toEqual([]);
  });
});
