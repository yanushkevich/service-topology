import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../state/uiStore';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { createWritableRepository } from '../../test/writableRepository';

async function openNew(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(await screen.findByRole('button', { name: 'New' }));
  await user.click(within(screen.getByRole('menu', { name: 'Create' })).getByRole('menuitem', { name: new RegExp(`^${kind}`) }));
  return screen.getByRole('dialog', { name: `New ${kind.toLowerCase()}` });
}

describe('editing the topology (ADR-020)', () => {
  beforeEach(resetUiStore);

  it('is read-only with built-in mock data, and says how to edit', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'payment-service.production' } });
    renderApp('/registry');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Built-in mock data is read-only/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Use the backend API' })[0]).toHaveAttribute('href', expect.stringContaining('source=api'));
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    expect(within(inspector).queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  });

  it('creates an environment with a suggested ID, then selects it', async () => {
    const user = userEvent.setup();
    const { repository, calls, current } = createWritableRepository();
    renderApp('/registry', repository);
    await screen.findByRole('table');
    const dialog = await openNew(user, 'Environment');
    expect(within(dialog).getByRole('textbox', { name: /^Name/ })).toHaveFocus();
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'QA Load');
    expect(within(dialog).getByRole('textbox', { name: /^ID/ })).toHaveValue('qa-load');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).toEqual([{ op: 'create', kind: 'environment', id: 'qa-load', entity: { id: 'qa-load', name: 'QA Load', kind: 'other' } }]);
    expect(current().environments.map((e) => e.id)).toContain('qa-load');
    expect(useUiStore.getState().selection).toEqual({ kind: 'environment', id: 'qa-load' });
    // The reloaded topology is shown: the environment selector lists it.
    expect(within(screen.getByLabelText('Environment')).getByRole('option', { name: 'qa-load' })).toBeInTheDocument();
  });

  it('checks the whole topology before sending and explains what would break', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    renderApp('/registry', repository);
    await screen.findByRole('table');
    const dialog = await openNew(user, 'Connection');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^From/ }), 'order-service.production');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^To/ }), 'order-service.staging');
    expect(within(dialog).getByRole('textbox', { name: /^ID/ })).toHaveValue('rel:order-service.production->order-service.staging');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This change would break the topology');
    expect(alert).toHaveTextContent(/environment/i);
    expect(calls).toEqual([]);
  });

  it('reports required fields and duplicate IDs next to the field', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    renderApp('/registry', repository);
    await screen.findByRole('table');
    const dialog = await openNew(user, 'Service definition');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    const name = within(dialog).getByRole('textbox', { name: /^Name/ });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Required.');
    await user.type(name, 'Payment Service');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByRole('textbox', { name: /^ID/ })).toHaveAccessibleDescription(/Already used by another entity/);
    expect(calls).toEqual([]);
  });

  it('edits the stored values of an instance, not the simulated ones, from the inspector', async () => {
    const user = userEvent.setup();
    const { repository, calls, current } = createWritableRepository();
    useUiStore.setState({ selection: { kind: 'service-instance', id: 'payment-service.production' } });
    renderApp('/map', repository);
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    await user.click(await within(inspector).findByRole('button', { name: 'Edit Payment Service' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit service instance' });
    expect(within(dialog).getByRole('textbox', { name: /^ID/ })).toHaveAttribute('readonly');
    expect(within(dialog).getByRole('combobox', { name: /^Health/ })).toHaveValue('healthy');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /^Health/ }), 'degraded');
    await user.clear(within(dialog).getByRole('textbox', { name: /^Version/ }));
    await user.type(within(dialog).getByRole('textbox', { name: /^Version/ }), '9.9.9');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).toHaveLength(1);
    const stored = current().serviceInstances.find((i) => i.id === 'payment-service.production');
    expect(stored).toMatchObject({ health: 'degraded', version: '9.9.9' });
    expect(stored?.metrics?.isSimulated).toBe(true);
    // Focus returns to the page, and the inspector shows the saved version.
    expect(await within(inspector).findByText('9.9.9')).toBeInTheDocument();
  });

  it('refuses to delete something that is still referenced, listing the blockers', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    useUiStore.setState({ selection: { kind: 'resource', id: 'rds-orders-prod' } });
    renderApp('/registry', repository);
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    await user.click(await within(inspector).findByRole('button', { name: 'Delete orders-db' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete resource?' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('still referenced');
    expect(within(dialog).getByRole('button', { name: 'Delete resource' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('deletes an unreferenced connection and clears the selection', async () => {
    const user = userEvent.setup();
    const { repository, calls, current } = createWritableRepository();
    const rel = 'rel:legacy-report-cron.production->rds-orders-prod';
    useUiStore.setState({ selection: { kind: 'relationship', id: rel } });
    renderApp('/registry', repository);
    const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
    await user.click(await within(inspector).findByRole('button', { name: /^Delete Legacy Report Cron → / }));
    const dialog = screen.getByRole('dialog', { name: 'Delete connection?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete connection' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).toEqual([{ op: 'delete', kind: 'relationship', id: rel }]);
    expect(current().relationships.some((r) => r.id === rel)).toBe(false);
    expect(useUiStore.getState().selection).toBeNull();
  });

  it('tells the user to reload when someone else changed the topology (412)', async () => {
    const user = userEvent.setup();
    const { repository, state } = createWritableRepository();
    state.stale = true;
    renderApp('/registry', repository);
    await screen.findByRole('table');
    const dialog = await openNew(user, 'Environment');
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'QA');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Someone changed the topology');
    state.stale = false;
    await user.click(within(dialog).getByRole('button', { name: 'Reload data' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('creates an event type from the catalog and opens it', async () => {
    const user = userEvent.setup();
    const { repository, current } = createWritableRepository();
    const router = renderApp('/events', repository);
    await user.click(await screen.findByRole('button', { name: 'New event type' }));
    const dialog = screen.getByRole('dialog', { name: 'New event type' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'InvoicePaid');
    await user.click(within(within(dialog).getByRole('group', { name: /^Carried on/ })).getAllByRole('checkbox', { name: /orders\.events/ })[0]!);
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/events/event-invoicepaid'));
    expect(current().eventTypes?.some((e) => e.id === 'event-invoicepaid')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'InvoicePaid' })).toBeInTheDocument();
  });

  it('is disabled while viewing history', async () => {
    const user = userEvent.setup();
    const { repository } = createWritableRepository();
    useUiStore.setState({ asOf: 'fixture-0600' });
    renderApp('/registry', repository);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New' }));
    expect(await screen.findByText(/You are viewing history/)).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
