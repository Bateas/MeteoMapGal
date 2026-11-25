/** The phone side panel (P3 review, batch 2, 19-nov): Escape closes it, but not under a modal or in a text field. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MobileSidePanel } from './MobileSidePanel';

describe('the phone side panel', () => {
  it('Escape closes it', () => {
    const onClose = vi.fn();
    render(<MobileSidePanel onClose={onClose}><p>lista</p></MobileSidePanel>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a modal on top or a text field keeps its Escape', () => {
    const onClose = vi.fn();
    const { getByRole } = render(<MobileSidePanel onClose={onClose}><input aria-label="buscar" /></MobileSidePanel>);
    fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' });
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    modal.remove();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a tap on the backdrop closes it', () => {
    const onClose = vi.fn();
    const { container } = render(<MobileSidePanel onClose={onClose}><p>lista</p></MobileSidePanel>);
    fireEvent.click(container.querySelector('[role="presentation"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
