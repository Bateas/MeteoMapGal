/**
 * Random break of 12-nov night that went through with the whole suite green: the figure of a spot still being worked
 * out took the ink of its verdict colour instead of the plain ink. Checked to fail with that break.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SpotShape } from './SpotShape';
import { VERDICT_FILL_TEXT } from '../../config/verdictStyles';

const figureFill = (c: HTMLElement) => c.querySelector('text')!.getAttribute('fill');

describe('the ink of the figure inside a spot', () => {
  it('a spot with its verdict writes in the ink of that colour', () => {
    const { container } = render(<SpotShape verdict="good" value="15" />);
    expect(figureFill(container)).toBe(VERDICT_FILL_TEXT.good);
  });

  it('a spot still being worked out writes in plain ink', () => {
    const { container } = render(<SpotShape verdict="unknown" value={null} />);
    expect(figureFill(container)).toBe('var(--g-ink)');
  });

  it('a hollow one too', () => {
    const { container } = render(<SpotShape verdict="good" value="1,2" hollow pentagon />);
    expect(figureFill(container)).toBe('var(--g-ink)');
  });
});
