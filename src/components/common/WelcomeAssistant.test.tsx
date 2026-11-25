import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { WelcomeAssistant } from './WelcomeAssistant';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useSpotStore } from '../../store/spotStore';

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.setState({ onboardingStep: 0, onboardingCompleted: false, isMobile: true, simpleMode: true, campoOpen: false, fieldDrawerOpen: false, flyToTarget: null, guideOpen: false });
  useSectorStore.getState().switchSector('rias');
  useSpotStore.setState({ favoriteSpotId: null, activeSpotId: '' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const press = (name: RegExp | string) => fireEvent.click(screen.getByRole('button', { name }));

describe('the welcome assistant (18-nov)', () => {
  it('two questions when nothing about the water is ticked, and it falls onto the map', () => {
    render(<WelcomeAssistant />);
    expect(screen.getByRole('heading', { name: '¿Por dónde te mueves?' })).toBeTruthy();
    expect(screen.getByText('1 de 2')).toBeTruthy();
    press(/Interior/);
    press('Siguiente');
    press(/Helada y campo/);
    press('Listo');
    act(() => { vi.runAllTimers(); });
    expect(useUIStore.getState().onboardingCompleted).toBe(true);
    expect(useSectorStore.getState().activeSector.id).toBe('embalse');
    expect(useUIStore.getState().campoOpen).toBe(true);
    expect(useUIStore.getState().simpleMode).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wind and waves add the spot question; the spot becomes the favourite and its card opens', () => {
    render(<WelcomeAssistant />);
    press('Siguiente');
    press(/Viento y olas/);
    expect(screen.getByText('2 de 3')).toBeTruthy();
    press('Siguiente');
    press(/^Cesantes/);
    press('Listo');
    act(() => { vi.runAllTimers(); });
    expect(useSpotStore.getState().favoriteSpotId).toBe('cesantes');
    expect(useSpotStore.getState().activeSpotId).toBe('cesantes');
    expect(useUIStore.getState().flyToTarget).not.toBeNull();
  });

  it('the rain answer says it changes nothing, it just shows up when it happens', () => {
    render(<WelcomeAssistant />);
    press('Siguiente');
    press(/Lluvia, niebla y tormenta/);
    expect(screen.getByText(/salen solos en el mapa/)).toBeTruthy();
  });

  it('sea and tides on the coast open Condiciones; everything is advanced with «verlo todo»', () => {
    render(<WelcomeAssistant />);
    press('Siguiente');
    press(/Mar y mareas/);
    press(/Quiero verlo todo/);
    press('Listo');
    act(() => { vi.runAllTimers(); });
    expect(useUIStore.getState().fieldDrawerOpen).toBe(true);
    expect(useUIStore.getState().simpleMode).toBe(false);
  });

  it('«Saltar» leaves everything as it was', () => {
    render(<WelcomeAssistant />);
    press(/Interior/);
    press('Saltar');
    expect(useUIStore.getState().onboardingCompleted).toBe(true);
    expect(useSectorStore.getState().activeSector.id).toBe('rias');
    expect(useSpotStore.getState().favoriteSpotId).toBeNull();
  });

  it('whoever already did the tour never sees it', () => {
    useUIStore.setState({ onboardingStep: null, onboardingCompleted: true });
    render(<WelcomeAssistant />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the welcome assistant on a phone (review, 18-nov)', () => {
  it('waits while the side panel is open: it is not a dialog, and the questions came up over it', () => {
    useUIStore.setState({ onboardingStep: null, onboardingCompleted: false });
    const aside = document.createElement('aside');
    aside.className = 'gc-aside gc-aside--sheet';
    document.body.appendChild(aside);
    try {
      render(<WelcomeAssistant />);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      aside.remove();
    }
  });

  it('the focus stays inside: on the first answer of each panel, also after «Atrás»', () => {
    render(<WelcomeAssistant />);
    press('Siguiente');
    expect(document.activeElement?.textContent).toMatch(/Viento y olas/);
    press('Atrás');
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('a screen reader hears the question when the focus lands on the answers of each panel (P4, 18-nov)', () => {
    render(<WelcomeAssistant />);
    expect(screen.getByRole('group', { name: '¿Por dónde te mueves?' })).toBeTruthy();
    press('Siguiente');
    expect(screen.getByRole('group', { name: '¿Qué miras antes de salir?' })).toBeTruthy();
  });

  it('the back button of Android closes the questions', () => {
    render(<WelcomeAssistant />);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    expect(useUIStore.getState().onboardingCompleted).toBe(true);
  });
});
