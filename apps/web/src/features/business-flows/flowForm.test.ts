import { describe, expect, it } from 'vitest';
import { refundFlow } from '../../data/mock/businessFlows';
import { mockTopology } from '../../data/mock/topology';
import { validateTopology } from '../../domain/validation';
import { cleanFlow, duplicateFlow, flowFieldErrors, newFlowTemplate, nextId, suggestFlowId } from './flowForm';

describe('flow form model', () => {
  it('starts from a valid one-step template once it has a name and an ID', () => {
    const draft = { ...newFlowTemplate(mockTopology), id: 'flow-new', name: 'New' };
    draft.steps[0]!.name = 'Do it';
    expect(flowFieldErrors(draft)).toEqual({});
    const data = { ...mockTopology, businessFlows: [...mockTopology.businessFlows!, cleanFlow(draft)] };
    expect(validateTopology(data)).toEqual([]);
  });

  it('reports required fields, bad and duplicate IDs, and missing event types by path', () => {
    const draft = newFlowTemplate(mockTopology);
    draft.steps.push({ id: 'step-1', name: '', serviceDefinitionId: '', kind: 'task' });
    draft.transitions[0]!.via = { kind: 'event', eventTypeId: '' };
    draft.transitions[0]!.policies.push({ type: 'retry', label: ' ', state: 'exercised' });
    expect(flowFieldErrors(draft)).toMatchObject({
      id: 'Required.',
      name: 'Required.',
      'steps.0.name': 'Required.',
      'steps.1.id': 'Used twice in this flow.',
      'steps.1.serviceDefinitionId': 'Required.',
      'transitions.0.eventTypeId': expect.stringContaining('Choose the event'),
      'transitions.0.policies.0.label': 'Required.',
    });
  });

  it('trims text and omits empty optionals', () => {
    const draft = { ...structuredClone(refundFlow), description: '  ', owner: ' Payments ' };
    draft.steps[0]!.entryPoint = '';
    draft.transitions[0]!.condition = '';
    const clean = cleanFlow(draft);
    expect(clean).not.toHaveProperty('description');
    expect(clean.owner).toBe('Payments');
    expect(clean.steps[0]).not.toHaveProperty('entryPoint');
    expect(clean.transitions[0]).not.toHaveProperty('condition');
  });

  it('duplicates an imported flow as an authored copy with a free ID', () => {
    const imported = { ...refundFlow, source: { kind: 'imported' as const, format: 'bpmn', ref: 'refund.bpmn', importedAt: '2026-10-12T08:00:00Z' } };
    const copy = duplicateFlow(imported, { ...mockTopology, businessFlows: [...mockTopology.businessFlows!, { ...refundFlow, id: 'flow-refund-copy' }] });
    expect(copy).toMatchObject({ id: 'flow-refund-copy-2', name: 'Refund (copy)', source: { kind: 'authored' } });
    expect(suggestFlowId(' Order Returns ')).toBe('flow-order-returns');
    expect(nextId('step', ['step-1', 'step-3'])).toBe('step-4');
  });
});
