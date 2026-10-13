import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { mockTopology } from '../../data/mock/topology';
import { generateTopology, SCALE_250 } from '../../data/mock/generateTopology';
import { createMockTopologyRepository } from '../../data/repositories/mockTopologyRepository';
import { createSandbox } from '../../data/sandbox/sandbox';
import { createSandboxStorage } from '../../data/sandbox/storage';
import { createTransitRepository } from '../../data/transitRepository';
import { bundleOf } from '../../data/bundle/bundle';
import { readBundle, serializeBundle } from '../../data/bundle/format';
import { definitionOf } from '../../transit/definition';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';

const downloads: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  resetUiStore();
  downloads.length = 0;
  let last: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    last = blob as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (last) downloads.push({ name: this.download, blob: last });
  });
});
afterEach(() => vi.restoreAllMocks());

const setup = () => {
  const sandbox = createSandbox(mockTopology, createSandboxStorage(null));
  renderApp('/settings', sandbox.topology, undefined, undefined, createTransitRepository(sandbox.boards));
  return sandbox;
};
const file = (name: string, text: string) => new File([text], name, { type: 'text/plain' });

describe('export and import in Settings (ADR-032)', () => {
  it('exports the sandbox as YAML with every module and the example board', async () => {
    const user = userEvent.setup();
    setup();
    const table = await screen.findByRole('table', { name: 'What an export contains' });
    await waitFor(() => expect(within(table).getByRole('row', { name: /Transit boards/ })).toHaveTextContent('1'));
    await user.click(screen.getByRole('button', { name: 'Export YAML' }));
    await screen.findByText(/^Exported service-topology-mock-inventory-local-sandbox-\d{4}-\d{2}-\d{2}\.yaml\.$/);
    expect(downloads).toHaveLength(1);
    const read = readBundle(await downloads[0]!.blob.text(), 'yaml');
    if (!read.ok) throw new Error(JSON.stringify(read.issues));
    expect(read.bundle.serviceDefinitions).toEqual(mockTopology.serviceDefinitions);
    expect(read.bundle.transitBoards.map((b) => b.serviceDefinitionId)).toEqual(['payment-service']);
    expect(read.bundle.source).toEqual({ label: 'Mock inventory · local sandbox', isMock: true });
  });

  it('previews a valid file, then replaces the sandbox data after confirmation', async () => {
    const user = userEvent.setup();
    const sandbox = setup();
    const changed = { ...mockTopology, environments: [...mockTopology.environments, { id: 'qa', name: 'QA', kind: 'other' as const }] };
    const bundle = bundleOf(changed, [definitionOf(paymentServiceBoard('production'))], { exportedAt: '2026-10-13T09:30:00Z', source: { label: 'Elsewhere', isMock: true } });
    await user.upload(await screen.findByLabelText(/^Data file/), file('data.json', serializeBundle(bundle, 'json')));
    const preview = await screen.findByRole('region', { name: 'data.json' });
    expect(preview).toHaveTextContent('Ready to import. Exported 2026-10-13T09:30:00Z from “Elsewhere”.');
    const envRow = within(within(preview).getByRole('table', { name: 'Current data and the file' })).getByRole('row', { name: /Environments/ });
    expect(envRow).toHaveTextContent(`${mockTopology.environments.length}${mockTopology.environments.length + 1}`);
    await user.click(screen.getByRole('button', { name: 'Replace data' }));
    await user.click(screen.getByRole('button', { name: 'Confirm replace' }));
    await screen.findByText(/^Imported into the local sandbox \(this browser only\): \d+ environments/);
    expect((await sandbox.topology.getTopology()).environments.map((e) => e.id)).toContain('qa');
    expect((await sandbox.boards.get('payment-service'))?.revision).toBe('1');
  });

  it('lists the issues of an invalid file and offers no import', async () => {
    const user = userEvent.setup();
    setup();
    await user.upload(await screen.findByLabelText(/^Data file/), file('broken.yaml', 'format: service-topology.bundle\nversion: 2\n'));
    const preview = await screen.findByRole('region', { name: 'broken.yaml' });
    expect(preview).toHaveTextContent('1 issue: this file cannot be imported.');
    expect(within(preview).getByRole('list', { name: 'Issues' })).toHaveTextContent('version Bundle version 2 is not supported');
    expect(screen.queryByRole('button', { name: 'Replace data' })).toBeNull();
  });

  it('exports but does not import a generated dataset', async () => {
    renderApp('/settings', createMockTopologyRepository(generateTopology(SCALE_250), 'Generated dataset “scale-250”'), undefined, undefined, createTransitRepository(null));
    expect(await screen.findByRole('button', { name: 'Export JSON' })).toBeEnabled();
    expect(screen.getByText(/Not available for generated datasets/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Data file/)).toBeNull();
  });
});
