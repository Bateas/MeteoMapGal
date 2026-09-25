/**
 * KeyboardShortcutHelp — a modal dialog, so one Escape closes only the help.
 *
 * The map popups close on Escape unless an aria-modal dialog is open. Without
 * aria-modal here, the help opened with '?' over a popup would take the popup
 * down with it on the same key press.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { WebcamPopup } from '../map/WebcamPopup';
import { RIAS_WEBCAMS } from '../../config/webcams';

afterEach(() => {
  cleanup();
});

describe('KeyboardShortcutHelp', () => {
  it('opens as a modal dialog', () => {
    render(<KeyboardShortcutHelp />);
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: 'Atajos de teclado' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('with a popup behind it, Escape closes the help and leaves the popup', () => {
    const onClose = vi.fn();
    render(
      <>
        <WebcamPopup webcam={RIAS_WEBCAMS[0]} onClose={onClose} />
        <KeyboardShortcutHelp />
      </>,
    );
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Atajos de teclado')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByText('Atajos de teclado')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // The next Escape is the popup's.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
