import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpotReportBox } from './SpotReportBox';

describe('SpotReportBox', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks about the wind straight away and shows the rest only after an answer', () => {
    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    expect(screen.getByText(/comparado con los 12 kt/)).toBeTruthy();
    expect(screen.queryByText('Enviar')).toBeNull();                 // nothing to send before the main answer
    expect(screen.queryByText('Espejo')).toBeNull();
    fireEvent.click(screen.getByText('Igual'));
    expect(screen.getByText('Espejo')).toBeTruthy();
    expect((screen.getByText('Enviar') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(screen.queryByText('Enviar')).toBeNull();
  });

  it('sends the facts plus what the app showed, thanks the user, then waits before another report', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    fireEvent.click(screen.getByText('Más'));
    fireEvent.click(screen.getByText('Mucha espuma'));
    fireEvent.click(screen.getByText('SO'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ spotId: 'cesantes', windVsApp: 1, waterState: 3, dirSeen: 225, appWindKt: 12.4, appVerdict: 'good' });
    unmount();

    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    expect(screen.getByText(/Ya enviaste un reporte/)).toBeTruthy();
    expect(screen.queryByText('Más')).toBeNull();
  });

  it('sends with only the wind answer, the other two are optional', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    fireEvent.click(screen.getByText('Menos'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ windVsApp: -1, waterState: null, dirSeen: null });
  });

  it('says so when the server does not take it, without blocking a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<SpotReportBox spotId="castrelo" shownWindKt={null} shownVerdict="calm" />);
    expect(screen.getByText(/comparado con lo que dice la app/)).toBeTruthy();
    fireEvent.click(screen.getByText('Igual'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/No se pudo enviar/)).toBeTruthy());
    expect((screen.getByText('Enviar') as HTMLButtonElement).disabled).toBe(false);
  });
});
