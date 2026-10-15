import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../data/http/apiClient';
import { renderApp, resetUiStore } from '../../test/renderApp';
import { createFakeIntegration, readyPreview, repositoryWithIntegration } from '../../test/fakeIntegration';

/** Settings → Data source → Dynatrace (ADR-034). */

const open = (fake = createFakeIntegration()) => {
  renderApp('/settings', repositoryWithIntegration(fake.integration));
  return fake;
};

describe('Dynatrace in Settings', () => {
  beforeEach(resetUiStore);

  it('is absent with built-in data, and explains a backend without a connection', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Data source' });
    expect(screen.queryByText('Dynatrace')).not.toBeInTheDocument();

    resetUiStore();
    document.body.innerHTML = '';
    open(createFakeIntegration({ status: null }));
    expect(await screen.findByText(/Not connected\. Set/)).toHaveTextContent('DYNATRACE_CONFIG_FILE');
  });

  it('shows the connection, never a secret, and how current observations are', async () => {
    open();
    const details = (await screen.findByText('abc12345.apps.dynatrace.com')).closest('dl') as HTMLElement;
    expect(details).toHaveTextContent('(OAuth client)');
    expect(details).toHaveTextContent('Production ← tag environment = production');
    expect(details).toHaveTextContent('Never applied');
    expect(details).toHaveTextContent(/12 entities observed at .*; refreshed every 60 s\./);
  });

  it('checks the connection query by query', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText('1 of 3 queries failed.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Connection check' });
    expect(within(table).getByRole('row', { name: /problems/ })).toHaveTextContent('Missing scopes: storage:events:read');
    expect(within(table).getByRole('row', { name: /service-calls/ })).toHaveTextContent('Missing fields: target_type');
  });

  it('previews a sync, then applies it and reloads', async () => {
    const user = userEvent.setup();
    const fake = open();
    await user.click(await screen.findByRole('button', { name: 'Preview sync' }));
    expect(await screen.findByText('Preview ready: 3 new, 1 linked, 1 kept, still used.')).toBeInTheDocument();
    const summary = screen.getByRole('table', { name: 'Changes by kind' });
    expect(within(summary).getByRole('row', { name: /^Services/ })).toHaveTextContent(/1\s*1/);
    expect(screen.getByRole('list', { name: 'Notes on this sync' })).toHaveTextContent('1 call crosses environments and was dropped.');
    expect(screen.getByRole('list', { name: 'Every change' })).toHaveTextContent('used by flow-checkout');
    await user.click(screen.getByRole('button', { name: 'Apply 5 changes' }));
    expect(await screen.findByText('Applied: 3 new, 1 linked, 1 kept, still used.')).toBeInTheDocument();
    expect(fake.calls.applied).toEqual(['preview-1']);
    expect(screen.queryByRole('button', { name: /^Apply/ })).not.toBeInTheDocument();
  });

  it('refuses to apply a preview whose result would not validate', async () => {
    const user = userEvent.setup();
    open(createFakeIntegration({ preview: { ...readyPreview, canApply: false, issues: [{ code: 'cross-environment-relationship', entityId: 'rel:x', message: 'Relationship crosses environments' }] } }));
    await user.click(await screen.findByRole('button', { name: 'Preview sync' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('rel:x: Relationship crosses environments');
    expect(screen.getByRole('button', { name: 'Apply 5 changes' })).toBeDisabled();
  });

  it('explains a topology that changed after the preview', async () => {
    const user = userEvent.setup();
    open(createFakeIntegration({ applyError: new ApiError(412, 'Precondition failed', 'req-1') }));
    await user.click(await screen.findByRole('button', { name: 'Preview sync' }));
    await user.click(await screen.findByRole('button', { name: 'Apply 5 changes' }));
    expect(await screen.findByText('Not applied: the topology changed after the preview. Preview again.')).toBeInTheDocument();
  });

  it('maps a Dynatrace name to an existing service', async () => {
    const user = userEvent.setup();
    const fake = open();
    await user.click(await screen.findByRole('button', { name: 'Add alias' }));
    const save = screen.getByRole('button', { name: 'Save aliases' });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Dynatrace name 1'), 'PaymentService');
    await user.selectOptions(screen.getByLabelText('Service for alias 1'), 'payment-service');
    await user.click(save);
    expect(await screen.findByText('Saved 1 alias. The next preview uses them.')).toBeInTheDocument();
    expect(fake.calls.saved).toEqual([{ PaymentService: 'payment-service' }]);
    // Two aliases for one name cannot be saved.
    await user.click(screen.getByRole('button', { name: 'Add alias' }));
    await user.type(screen.getByLabelText('Dynatrace name 2'), 'PaymentService');
    await user.selectOptions(screen.getByLabelText('Service for alias 2'), 'ledger-service');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save aliases' })).toBeDisabled());
    expect(screen.getByText('Each Dynatrace name can have one alias.')).toBeInTheDocument();
  });
});
