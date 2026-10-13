import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockTopology } from '../../data/mock/topology';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { createWritableRepository } from '../../test/writableRepository';
import type { TopologyData } from '../../domain/types';

const dialog = (name: RegExp | string) => screen.getByRole('dialog', { name });

describe('authoring business flows (ADR-022, phase 6)', () => {
  beforeEach(resetUiStore);

  it('creates a flow whose call is backed by the topology, then opens its board', async () => {
    const user = userEvent.setup();
    const { repository, calls, current } = createWritableRepository();
    const router = renderApp('/flows', repository);
    await user.click(await screen.findByRole('button', { name: 'New business flow' }));
    const form = dialog('New business flow');
    await user.type(within(form).getByRole('textbox', { name: /^Name/ }), 'Reorder');
    expect(within(form).getByRole('textbox', { name: /^ID/ })).toHaveValue('flow-reorder');
    await user.type(within(form).getByRole('textbox', { name: /^Step 1 name/ }), 'Place order');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Step 1 service/ }), 'order-service');
    await user.click(within(form).getByRole('button', { name: 'Add step' }));
    await user.type(within(form).getByRole('textbox', { name: /^Step 2 name/ }), 'Charge');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Step 2 service/ }), 'payment-service');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 1 to/ }), 'step-2');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 1 via/ }), 'call');
    await user.click(within(form).getByRole('button', { name: 'Add policy to transition 1' }));
    await user.type(within(form).getByRole('textbox', { name: /^Transition 1 policy 1 label/ }), '3 s');
    await user.click(within(form).getByRole('button', { name: 'Add transition' }));
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 2 from/ }), 'step-2');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 2 to/ }), 'done');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows/flow-reorder'));
    expect(calls).toEqual([expect.objectContaining({ op: 'create', kind: 'business-flow', id: 'flow-reorder' })]);
    const saved = current().businessFlows?.find((f) => f.id === 'flow-reorder');
    expect(saved?.transitions[0]).toEqual({ id: 't-1', from: 'step-1', to: 'step-2', via: { kind: 'call' }, policies: [{ type: 'timeout', label: '3 s', state: 'exercised' }] });
  });

  it('refuses a transition the topology does not back, before sending', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    renderApp('/flows', repository);
    await user.click(await screen.findByRole('button', { name: 'New business flow' }));
    const form = dialog('New business flow');
    await user.type(within(form).getByRole('textbox', { name: /^Name/ }), 'Ledger call');
    await user.type(within(form).getByRole('textbox', { name: /^Step 1 name/ }), 'Request');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Step 1 service/ }), 'catalog-service');
    await user.click(within(form).getByRole('button', { name: 'Add step' }));
    await user.type(within(form).getByRole('textbox', { name: /^Step 2 name/ }), 'Post');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Step 2 service/ }), 'ledger-service');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 1 to/ }), 'step-2');
    await user.selectOptions(within(form).getByRole('combobox', { name: /^Transition 1 via/ }), 'call');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/This flow would break the topology/);
    expect(calls).toEqual([]);
  });

  it('shows field errors next to the fields', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    renderApp('/flows', repository);
    await user.click(await screen.findByRole('button', { name: 'New business flow' }));
    const form = dialog('New business flow');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    expect(within(form).getByRole('textbox', { name: /^Name/ })).toHaveAccessibleDescription('Required.');
    expect(within(form).getByRole('textbox', { name: /^Step 1 name/ })).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toEqual([]);
  });

  it('edits and deletes an authored flow from its board', async () => {
    const user = userEvent.setup();
    const { repository, calls } = createWritableRepository();
    const router = renderApp('/flows/flow-refund?v=1&env=production', repository);
    const card = await screen.findByLabelText('Flow card');
    await user.click(within(card).getByRole('button', { name: 'Edit Refund' }));
    const form = dialog('Edit business flow');
    expect(within(form).getByRole('textbox', { name: /^ID/ })).toHaveAttribute('readonly');
    await user.clear(within(form).getByRole('textbox', { name: /^Owner/ }));
    await user.type(within(form).getByRole('textbox', { name: /^Owner/ }), 'Finance');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.at(-1)).toMatchObject({ op: 'update', kind: 'business-flow', id: 'flow-refund' });
    await user.click(within(await screen.findByLabelText('Flow card')).getByRole('button', { name: 'Delete Refund' }));
    await user.click(within(screen.getByRole('dialog', { name: /^Delete business flow/ })).getByRole('button', { name: 'Delete business flow' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows'));
    expect(calls.at(-1)).toEqual({ op: 'delete', kind: 'business-flow', id: 'flow-refund' });
  });

  it('keeps imported flows read-only and offers an authored copy', async () => {
    const user = userEvent.setup();
    const data: TopologyData = structuredClone(mockTopology);
    data.businessFlows = data.businessFlows!.map((f) => (f.id === 'flow-refund' ? { ...f, source: { kind: 'imported', format: 'bpmn', ref: 'refund.bpmn', importedAt: '2026-10-12T08:00:00Z' } } : f));
    const { repository, calls } = createWritableRepository(data);
    const router = renderApp('/flows/flow-refund?v=1&env=production', repository);
    const card = await screen.findByLabelText('Flow card');
    expect(card).toHaveTextContent(/Imported from refund.bpmn \(bpmn\); read-only here\./);
    expect(within(card).queryByRole('button', { name: 'Edit Refund' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Duplicate as authored flow' }));
    const form = dialog('New business flow');
    expect(within(form).getByRole('textbox', { name: /^Name/ })).toHaveValue('Refund (copy)');
    expect(within(form).getByRole('textbox', { name: /^ID/ })).toHaveValue('flow-refund-copy');
    await user.click(within(form).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/flows/flow-refund-copy'));
    expect(calls).toEqual([expect.objectContaining({ op: 'create', kind: 'business-flow', id: 'flow-refund-copy', entity: expect.objectContaining({ source: { kind: 'authored' } }) })]);
  });

  it('is read-only with built-in mock data', async () => {
    renderApp('/flows/flow-checkout?v=1&env=production');
    const card = await screen.findByLabelText('Flow card');
    expect(card).toHaveTextContent(/Built-in mock data is read-only/);
    expect(screen.queryByRole('button', { name: 'New business flow' })).not.toBeInTheDocument();
  });
});
