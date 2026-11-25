/**
 * The sheet of a phone has two heights: peeking (the head of the card, the map above still in use) and
 * open. jsdom lays nothing out, so the sizes the sheet measures are given here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('react-map-gl/maplibre', () => ({ useMap: () => ({ current: null }) }));

import { Ficha, dragOutcome, peekOf, PEEK_MAX_MARKED } from './Ficha';
import { makeMarkerButton } from './markerA11y';
import type { MarkerInstance } from 'react-map-gl/maplibre';
import { useUIStore } from '../../store/uiStore';

/** A card whose first group starts `head` px down and that is `total` px tall. */
function layout(head: number, total: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.closest('.gf-group') ? head : 0;
    return { top, bottom: top, left: 0, right: 0, x: 0, y: top, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(total);
}

const card = (onClose = () => {}) => (
  <Ficha longitude={-8.7} latitude={42.3} onClose={onClose} titleId="t">
    <h2 id="t">Cesantes</h2>
    <section className="gf-group"><button type="button">Ver previsión detallada</button></section>
  </Ficha>
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUIStore.setState({ isMobile: false });
});

describe('where the head of a card ends', () => {
  it('a card that fits in the tallest head is shown whole', () => {
    expect(peekOf(120, 230)).toEqual({ px: 230, more: false });
  });
  it('a long card peeks down to its first group', () => {
    expect(peekOf(176, 900)).toEqual({ px: 176, more: true });
  });
  it('a head is never a sliver nor half the screen', () => {
    expect(peekOf(40, 900).px).toBe(96);
    expect(peekOf(520, 900).px).toBe(240);
  });
  it('a long card without groups peeks at the cap', () => {
    expect(peekOf(null, 900)).toEqual({ px: 240, more: true });
  });
  it('a card that marks its first look may peek further, up to its own cap', () => {
    expect(peekOf(345, 735, PEEK_MAX_MARKED)).toEqual({ px: 345, more: true });
    expect(peekOf(520, 735, PEEK_MAX_MARKED)).toEqual({ px: PEEK_MAX_MARKED, more: true });
    expect(peekOf(345, 380, PEEK_MAX_MARKED)).toEqual({ px: 380, more: false });
  });
});

describe('the spot card peeks down to its graph (18-nov: verdict and the coming hours without sliding)', () => {
  it('the sheet measures to the end of the marked part, not to the first group', () => {
    useUIStore.setState({ isMobile: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.hasAttribute('data-peek-end') ? 330 : 0;
      const top = this.classList.contains('gf-group') ? 176 : 0;
      return { top, bottom, left: 0, right: 0, x: 0, y: top, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(735);
    render(
      <Ficha longitude={-8.1} latitude={42.3} onClose={() => {}} titleId="t">
        <h2 id="t">Castrelo</h2>
        <section className="gf-group"><div data-peek-end="">gráfica</div></section>
      </Ficha>,
    );
    // 330 to the end of the graph plus a little air
    expect(screen.getByRole('region', { name: 'Castrelo' }).style.getPropertyValue('--gf-peek')).toBe('338px');
  });
});

describe('what the end of a drag does', () => {
  it('up opens a peeking sheet, and does nothing to an open one', () => {
    expect(dragOutcome(-60, 'peek', true)).toBe('open');
    expect(dragOutcome(-60, 'open', true)).toBeNull();
  });
  it('down folds an open sheet, and closes a peeking one', () => {
    expect(dragOutcome(80, 'open', true)).toBe('peek');
    expect(dragOutcome(80, 'peek', true)).toBe('close');
  });
  it('a card with one height closes on the way down and ignores the way up', () => {
    expect(dragOutcome(80, 'peek', false)).toBe('close');
    expect(dragOutcome(-80, 'peek', false)).toBeNull();
  });
  it('a short drag is nothing', () => {
    expect(dragOutcome(20, 'open', true)).toBeNull();
    expect(dragOutcome(-20, 'peek', true)).toBeNull();
  });
});

describe('the sheet on a phone', () => {
  it('starts peeking: a region beside the map, with a visible button to see it all', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    render(card());
    expect(screen.getByRole('region', { name: 'Cesantes' })).toHaveAttribute('data-detent', 'peek');
    expect(screen.queryByRole('dialog')).toBeNull();
    const more = screen.getByRole('button', { name: /Ver todo/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    // Peeking the map is in use: the focus is not taken into the sheet
    expect(screen.getByRole('region', { name: 'Cesantes' }).contains(document.activeElement)).toBe(false);
  });

  it('the button opens it and folds it back', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    render(card());
    fireEvent.click(screen.getByRole('button', { name: /Ver todo/ }));
    expect(screen.getByRole('dialog', { name: 'Cesantes' })).toHaveAttribute('data-detent', 'open');
    fireEvent.click(screen.getByRole('button', { name: /Recoger/ }));
    expect(screen.getByRole('region', { name: 'Cesantes' })).toHaveAttribute('data-detent', 'peek');
  });

  it('opened with the keyboard it takes the focus even peeking, and gives it back to the marker (P4, 18-nov)', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      makeMarkerButton({ getElement: () => el } as unknown as MarkerInstance, 'Spot Cesantes', () => {});
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      // The marker re-renders as the selected one: the browser drops the focus
      el.blur();
      const view = render(card());
      const sheet = screen.getByRole('region', { name: 'Cesantes' });
      expect(document.activeElement).toBe(sheet);
      view.unmount();
      expect(document.activeElement).toBe(el);
    } finally {
      el.remove();
    }
  });

  it('opening it moves the focus without scrolling anything (18-nov: the map box scrolled 256 px)', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(card());
    fireEvent.click(screen.getByRole('button', { name: /Ver todo/ }));
    expect(focus).toHaveBeenCalled();
    for (const call of focus.mock.calls) expect(call[0]).toEqual({ preventScroll: true });
  });

  it('a card swiped away and gone within 200 ms does not close the next one (review, 18-nov)', () => {
    vi.useFakeTimers();
    try {
      useUIStore.setState({ isMobile: true });
      layout(176, 900);
      const onClose = vi.fn();
      const view = render(card(onClose));
      const handle = screen.getByRole('button', { name: /Ver todo/ });
      fireEvent.touchStart(handle, { touches: [{ clientY: 400 }] });
      fireEvent.touchMove(handle, { touches: [{ clientY: 560 }] });
      fireEvent.touchEnd(handle);
      // Another marker picked at once: this card unmounts before its close timer runs
      view.unmount();
      vi.advanceTimersByTime(500);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a drag up on the head opens it; down from peeking closes the card', () => {
    vi.useFakeTimers();
    try {
      useUIStore.setState({ isMobile: true });
      layout(176, 900);
      const onClose = vi.fn();
      render(card(onClose));
      const handle = screen.getByRole('button', { name: /Ver todo/ });
      fireEvent.touchStart(handle, { touches: [{ clientY: 500 }] });
      fireEvent.touchMove(handle, { touches: [{ clientY: 420 }] });
      fireEvent.touchEnd(handle);
      expect(screen.getByRole('dialog', { name: 'Cesantes' })).toBeInTheDocument();
      // The click a browser sends after that drag is not a tap on the button
      fireEvent.click(screen.getByRole('button', { name: /Recoger/ }));
      expect(screen.getByRole('dialog', { name: 'Cesantes' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Recoger/ }));
      const peeking = screen.getByRole('button', { name: /Ver todo/ });
      fireEvent.touchStart(peeking, { touches: [{ clientY: 500 }] });
      fireEvent.touchMove(peeking, { touches: [{ clientY: 600 }] });
      fireEvent.touchEnd(peeking);
      act(() => { vi.advanceTimersByTime(250); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the sheet follows the finger down only from its lowest height', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    const { container } = render(card());
    const box = () => container.querySelector('.gf-sheetbox') as HTMLElement;
    // Peeking is the lowest height of a long card: the sheet goes down with the finger
    const peeking = screen.getByRole('button', { name: /Ver todo/ });
    fireEvent.touchStart(peeking, { touches: [{ clientY: 500 }] });
    fireEvent.touchMove(peeking, { touches: [{ clientY: 560 }] });
    expect(box().style.transform).toBe('translateY(60px)');
    fireEvent.touchMove(peeking, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(peeking);
    // Open, a drag down folds it back to peeking at the end: it does not slide away under the finger
    // (the click a browser sends after a drag is not a tap: the second one opens)
    fireEvent.click(screen.getByRole('button', { name: /Ver todo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ver todo/ }));
    box().style.transform = '';
    const handle = screen.getByRole('button', { name: /Recoger/ });
    fireEvent.touchStart(handle, { touches: [{ clientY: 500 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 560 }] });
    expect(box().style.transform).toBe('');
  });

  it('a short card, with one height, goes down with the finger', () => {
    useUIStore.setState({ isMobile: true });
    layout(120, 200);
    const { container } = render(card());
    const box = container.querySelector('.gf-sheetbox') as HTMLElement;
    const handle = container.querySelector('.gf-handle') as HTMLElement;
    fireEvent.touchStart(handle, { touches: [{ clientY: 500 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 540 }] });
    expect(box.style.transform).toBe('translateY(40px)');
  });

  it('focus reaching what is under the head opens the sheet for it', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    render(card());
    fireEvent.focusIn(screen.getByRole('button', { name: 'Ver previsión detallada' }));
    expect(screen.getByRole('dialog', { name: 'Cesantes' })).toBeInTheDocument();
  });

  it('a short card has one height: whole, a dialog, and no button to open it', () => {
    useUIStore.setState({ isMobile: true });
    layout(120, 200);
    render(card());
    expect(screen.getByRole('dialog', { name: 'Cesantes' })).toHaveAttribute('data-detent', 'open');
    expect(screen.queryByRole('button', { name: /Ver todo|Recoger/ })).toBeNull();
  });

  it('another marker picked with the sheet open: its card starts peeking', () => {
    useUIStore.setState({ isMobile: true });
    layout(176, 900);
    const { rerender } = render(card());
    fireEvent.click(screen.getByRole('button', { name: /Ver todo/ }));
    rerender(
      <Ficha longitude={-8.6} latitude={42.2} onClose={() => {}} titleId="t">
        <h2 id="t">Lourido</h2>
        <section className="gf-group">más</section>
      </Ficha>,
    );
    expect(screen.getByRole('region', { name: 'Lourido' })).toHaveAttribute('data-detent', 'peek');
  });

  it('Escape goes to a layer on top that closes with its own Escape, then to the card (P3 review, 19-nov)', () => {
    const onClose = vi.fn();
    render(card(onClose));
    const legend = document.createElement('div');
    legend.setAttribute('data-escape-first', '');
    document.body.appendChild(legend);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    legend.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on a desktop there is no sheet and no second height', () => {
    layout(176, 900);
    render(card());
    expect(screen.getByRole('region', { name: 'Cesantes' })).not.toHaveAttribute('data-detent');
    expect(screen.queryByRole('button', { name: /Ver todo|Recoger/ })).toBeNull();
  });
});
