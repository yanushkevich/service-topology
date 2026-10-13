import { describe, expect, it } from 'vitest';
import { mockTopology } from '../mock/topology';
import { definitionOf } from '../../transit/definition';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';
import { ApiError } from '../http/apiClient';
import { createSandbox } from './sandbox';
import { createSandboxStorage } from './storage';

/** A Storage double so tests can share or break "browser storage". */
function memoryStorage(fail = false): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => {
      if (fail) throw new Error('blocked');
      return map.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (fail) throw new Error('blocked');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
  };
}
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected a rejection');
};
const env = { id: 'sandbox-qa', name: 'QA', kind: 'other' as const };

describe('local sandbox (ADR-031)', () => {
  it('makes the built-in data editable, validates like the server, and keeps edits across reloads', async () => {
    const storage = memoryStorage();
    const first = createSandbox(mockTopology, createSandboxStorage(storage));
    expect(first.topology.sourceLabel).toBe('Mock inventory · local sandbox');
    await first.topology.writer!.create('environment', env);
    expect((await rejects(first.topology.writer!.create('environment', env))).status).toBe(409);
    // Deleting an environment that instances still use breaks whole-topology validation.
    const broken = await rejects(first.topology.writer!.remove('environment', 'production'));
    expect(broken.status).toBe(422);
    expect(broken.issues.length).toBeGreaterThan(0);

    const again = createSandbox(mockTopology, createSandboxStorage(storage));
    expect((await again.topology.getTopology()).environments.some((e) => e.id === 'sandbox-qa')).toBe(true);
    expect(again.topology.sandbox!.persistent).toBe(true);
    again.topology.sandbox!.reset();
    expect((await again.topology.getTopology()).environments.some((e) => e.id === 'sandbox-qa')).toBe(false);
    expect((await createSandbox(mockTopology, createSandboxStorage(storage)).topology.getTopology()).environments.some((e) => e.id === 'sandbox-qa')).toBe(false);
  });

  it('drops saved changes, with a notice, when the built-in data changed', async () => {
    const storage = memoryStorage();
    await createSandbox(mockTopology, createSandboxStorage(storage)).topology.writer!.create('environment', env);
    const changedBase = { ...mockTopology, environments: [...mockTopology.environments, { id: 'new-env', name: 'New', kind: 'other' as const }] };
    const later = createSandbox(changedBase, createSandboxStorage(storage));
    expect(later.topology.sandbox!.notice).toMatch(/built-in data changed/);
    expect((await later.topology.getTopology()).environments.some((e) => e.id === 'sandbox-qa')).toBe(false);
  });

  it('works in memory when browser storage is blocked, and says so', async () => {
    const sandbox = createSandbox(mockTopology, createSandboxStorage(memoryStorage(true)));
    await sandbox.topology.writer!.create('environment', env);
    expect((await sandbox.topology.getTopology()).environments.some((e) => e.id === 'sandbox-qa')).toBe(true);
    expect(sandbox.topology.sandbox!.persistent).toBe(false);
  });

  it('stores board definitions with revisions, validated against the sandbox topology', async () => {
    const { boards } = createSandbox(mockTopology, createSandboxStorage(memoryStorage()));
    const def = definitionOf(paymentServiceBoard('production'));
    expect(await boards.get('payment-service')).toBeNull();
    const created = await boards.create(def);
    expect(created.revision).toBe('1');
    expect((await rejects(boards.create(def))).status).toBe(409);
    const renamed = { ...def, lines: def.lines.map((l, i) => (i === 0 ? { ...l, name: 'Authorize a payment' } : l)) };
    expect((await boards.replace(renamed, '1')).revision).toBe('2');
    expect((await rejects(boards.replace(renamed, '1'))).status).toBe(412);
    const invalid = await rejects(boards.replace({ ...renamed, policies: [{ ...renamed.policies[0]!, clientId: 'mod:capture' }, ...renamed.policies.slice(1)] }, '2'));
    expect(invalid.status).toBe(422);
    expect(invalid.issues.map((i) => `${i.code} ${i.path}`)).toEqual(['invalid-board-policy policies[0].clientId']);
    expect((await rejects(boards.remove('payment-service', '1'))).status).toBe(412);
    await boards.remove('payment-service', '2');
    expect(await boards.get('payment-service')).toBeNull();
  });
});
