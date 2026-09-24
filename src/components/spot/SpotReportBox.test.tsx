import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpotReportBox } from './SpotReportBox';

describe('SpotReportBox', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('starts as one discreet line and opens into the two questions', () => {
    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    fireEvent.click(screen.getByText(/Dinos si coincide/));
    expect(screen.getByText(/comparado con los 12 kt/)).toBeTruthy();
    expect((screen.getByText('Enviar') as HTMLButtonElement).disabled).toBe(true);   // wind answer required
  });

  it('sends the facts plus what the app showed, thanks the user, then waits before another report', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    fireEvent.click(screen.getByText(/Dinos si coincide/));
    fireEvent.click(screen.getByText('Más'));
    fireEvent.click(screen.getByText('Mucha'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ spotId: 'cesantes', windVsApp: 1, whitecaps: 2, appWindKt: 12.4, appVerdict: 'good' });
    unmount();

    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    fireEvent.click(screen.getByText(/Dinos si coincide/));
    expect(screen.getByText(/Ya enviaste un reporte/)).toBeTruthy();
  });

  it('says so when the server does not take it, without blocking a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<SpotReportBox spotId="castrelo" shownWindKt={null} shownVerdict="calm" />);
    fireEvent.click(screen.getByText(/Dinos si coincide/));
    expect(screen.getByText(/comparado con lo que dice la app/)).toBeTruthy();
    fireEvent.click(screen.getByText('Igual'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/No se pudo enviar/)).toBeTruthy());
    expect((screen.getByText('Enviar') as HTMLButtonElement).disabled).toBe(false);
  });
});
