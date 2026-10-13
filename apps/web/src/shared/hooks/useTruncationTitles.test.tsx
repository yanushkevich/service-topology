import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTruncationTitles } from './useTruncationTitles';

function Harness({ title }: { title?: string }) {
  useTruncationTitles();
  return (
    <span data-testid="name" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={title}>
      <b data-testid="inner">Notification Service</b>
    </span>
  );
}

/** jsdom has no layout: give the element the widths a browser would measure. */
function widths(el: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
}

describe('useTruncationTitles', () => {
  it('adds the full text as a tooltip to a truncated name, from a child of it too', () => {
    render(<Harness />);
    const name = screen.getByTestId('name');
    widths(name, 180, 90);
    fireEvent.pointerOver(screen.getByTestId('inner'));
    expect(name).toHaveAttribute('title', 'Notification Service');
  });

  it('removes its tooltip once the text fits, and leaves text that fits alone', () => {
    render(<Harness />);
    const name = screen.getByTestId('name');
    widths(name, 180, 90);
    fireEvent.pointerOver(name);
    widths(name, 90, 90);
    fireEvent.pointerOver(name);
    expect(name).not.toHaveAttribute('title');
  });

  it('keeps a title the element already has', () => {
    render(<Harness title="Notification Service (notification-service.production)" />);
    const name = screen.getByTestId('name');
    widths(name, 180, 90);
    fireEvent.pointerOver(name);
    expect(name).toHaveAttribute('title', 'Notification Service (notification-service.production)');
  });
});
