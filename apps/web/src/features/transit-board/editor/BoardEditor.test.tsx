import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockTopology } from '../../../data/mock/topology';
import { createInMemorySavedLayoutRepository } from '../../../data/savedLayouts/SavedLayoutRepository';
import { createInMemorySnapshotRepository } from '../../../data/snapshots/SnapshotRepository';
import { mockSnapshots } from '../../../data/mock/snapshots';
import { createSandbox } from '../../../data/sandbox/sandbox';
import { createSandboxStorage } from '../../../data/sandbox/storage';
import { createTransitRepository } from '../../../data/transitRepository';
import { renderApp, resetUiStore } from '../../../test/renderApp';

const panel = (label: string) => {
  const element = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error(`No panel "${label}"`);
  return element;
};
const dialog = () => screen.getByRole('dialog');

/** The app on the local sandbox, as the default build runs it (ADR-031). */
function renderSandbox(path: string) {
  const sandbox = createSandbox(mockTopology, createSandboxStorage(null));
  renderApp(path, sandbox.topology, createInMemorySavedLayoutRepository(), createInMemorySnapshotRepository(mockSnapshots()), createTransitRepository(sandbox.boards));
  return sandbox;
}

describe('board editor (ADR-031)', () => {
  beforeEach(resetUiStore);

  it('creates a board for a service without one, then deletes it after confirmation', async () => {
    const user = userEvent.setup();
    const sandbox = renderSandbox('/services/order-service/transit?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Create a transit board' }));
    expect(dialog()).toHaveTextContent('New transit board: Order Service');
    expect(dialog()).toHaveTextContent('Saved to the local sandbox (this browser only)');
    expect(within(panel('Preview')).getByRole('status')).toHaveTextContent('No issues: ready to save.');
    await user.click(within(dialog()).getByRole('button', { name: 'Create board' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await sandbox.boards.get('order-service')).not.toBeNull();
    await waitFor(() => expect(panel('Lines')).toHaveTextContent('GET /health'));
    expect(document.body).toHaveTextContent('Sandbox board · not observed');

    await user.click(screen.getByRole('button', { name: 'Delete board' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Delete board' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No endpoints yet' })).toBeInTheDocument());
    expect(await sandbox.boards.get('order-service')).toBeNull();
  });

  it('blocks an invalid save, lists the issue, and focuses its field', async () => {
    const user = userEvent.setup();
    renderSandbox('/services/order-service/transit?v=1&env=production');
    await user.click(await screen.findByRole('button', { name: 'Create a transit board' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Add an endpoint' }));
    // The new endpoint takes the next free code; reuse the first one instead.
    const second = dialog().querySelector<HTMLDetailsElement>('[data-line-row="H2"]')!;
    second.open = true;
    const code = within(second).getByRole('textbox', { name: /Code/ });
    await user.clear(code);
    await user.type(code, 'H1');
    expect(within(panel('Preview')).getByRole('region', { name: 'Issues' })).toHaveTextContent('Line code “H1” is used twice.');
    await user.click(within(dialog()).getByRole('button', { name: 'Create board' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('1 issue to fix before saving.');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'lines[1].code'));
  });

  it('edits the example board into a stored copy that keeps the example stats', async () => {
    const user = userEvent.setup();
    const sandbox = renderSandbox('/services/payment-service/transit?v=1&env=production&line=A2');
    await user.click(await screen.findByRole('button', { name: 'Edit board' }));
    expect(dialog()).toHaveTextContent('Edit transit board: Payment Service');
    expect(dialog()).toHaveTextContent('saving stores your copy');
    const capture = dialog().querySelector<HTMLDetailsElement>('[data-line-row="A2"]')!;
    capture.open = true;
    const name = within(capture).getByRole('textbox', { name: /^Name/ });
    await user.clear(name);
    await user.type(name, 'Capture a payment');
    fireEvent.submit(dialog().querySelector('form')!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await sandbox.boards.get('payment-service'))?.definition.lines.find((l) => l.id === 'A2')?.name).toBe('Capture a payment');
    await waitFor(() => expect(panel('Line card')).toHaveTextContent('Capture a payment'));
    expect(document.body).toHaveTextContent('Sandbox board · example stats');
    expect(panel('Line card')).toHaveTextContent('5,887'); // the example's trace count is kept
  });

  it('offers no board editing when boards cannot be stored (generated datasets)', async () => {
    renderApp('/services/payment-service/transit?v=1&env=production');
    await waitFor(() => panel('Lines'));
    expect(screen.queryByRole('button', { name: 'Edit board' })).toBeNull();
  });
});

describe('business flows in the local sandbox (ADR-031)', () => {
  beforeEach(resetUiStore);

  it('lets the built-in data be edited: a new business flow can be started without the backend', async () => {
    const user = userEvent.setup();
    renderSandbox('/flows?v=1&env=production');
    const create = await screen.findByRole('button', { name: 'New business flow' });
    expect(create).toBeEnabled();
    await user.click(create);
    expect(dialog()).toHaveTextContent('New business flow');
  });
});
