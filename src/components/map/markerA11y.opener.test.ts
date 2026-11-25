/** P4 (18-nov): a card opened with the keyboard needs to know which marker opened it, and only just then. */
import { describe, it, expect } from 'vitest';
import type { MarkerInstance } from 'react-map-gl/maplibre';
import { makeMarkerButton, takeKeyboardOpener } from './markerA11y';

function marker() {
  const el = document.createElement('div');
  makeMarkerButton({ getElement: () => el } as unknown as MarkerInstance, 'Spot Cesantes', () => {});
  return el;
}
const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('the marker a card was opened from with the keyboard', () => {
  it('Enter or Space on a marker leaves it, read once', () => {
    const el = marker();
    press(el, 'Enter');
    expect(takeKeyboardOpener()).toBe(el);
    expect(takeKeyboardOpener()).toBeNull();
    press(el, ' ');
    expect(takeKeyboardOpener()).toBe(el);
  });

  it('a key that does not open nothing, and a press too old does not count', () => {
    const el = marker();
    press(el, 'a');
    expect(takeKeyboardOpener()).toBeNull();
    press(el, 'Enter');
    expect(takeKeyboardOpener(Date.now() + 5_000)).toBeNull();
  });
});
