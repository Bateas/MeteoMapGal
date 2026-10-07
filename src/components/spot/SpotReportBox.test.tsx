import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpotReportBox } from './SpotReportBox';
import { __clearRecentReportsCacheForTests } from '../../api/fieldReportClient';

// GETs answer with `summary`; POSTs with `post`.
const api = (post: { ok: boolean; status: number }, summary: unknown = null) =>
  vi.fn((_url: string, init?: { method?: string }) =>
    Promise.resolve(init?.method === 'POST' ? post : { ok: true, status: 200, json: () => Promise.resolve({ summary }) }));
const postBody = (m: ReturnType<typeof api>) => JSON.parse((m.mock.calls.find((c) => c[1]?.method === 'POST')![1] as { body: string }).body);

describe('SpotReportBox', () => {
  beforeEach(() => { localStorage.clear(); __clearRecentReportsCacheForTests(); vi.stubGlobal('fetch', api({ ok: true, status: 201 })); });
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
    const fetchMock = api({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    fireEvent.click(screen.getByText('Más'));
    fireEvent.click(screen.getByText('Mucha espuma'));
    fireEvent.click(screen.getByText('SO'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    expect(postBody(fetchMock)).toMatchObject({ spotId: 'cesantes', windVsApp: 1, waterState: 3, dirSeen: 225, appWindKt: 12.4, appVerdict: 'good' });
    unmount();

    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    expect(screen.getByText(/Ya enviaste un reporte/)).toBeTruthy();
    expect(screen.queryByText('Más')).toBeNull();
  });

  it('sends with only the wind answer, the other two are optional', async () => {
    const fetchMock = api({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    fireEvent.click(screen.getByText('Menos'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    expect(postBody(fetchMock)).toMatchObject({ windVsApp: -1, waterState: null, dirSeen: null });
  });

  it('says so when the server does not take it, without blocking a retry', async () => {
    vi.stubGlobal('fetch', api({ ok: false, status: 503 }));
    render(<SpotReportBox spotId="castrelo" shownWindKt={null} shownVerdict="calm" />);
    expect(screen.getByText(/comparado con lo que dice la app/)).toBeTruthy();
    fireEvent.click(screen.getByText('Igual'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/No se pudo enviar/)).toBeTruthy());
    expect((screen.getByText('Enviar') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows what was said here lately on top of the question, and nothing when nobody said anything', async () => {
    vi.stubGlobal('fetch', api({ ok: true, status: 201 }, { count: 2, newestMin: 15, wind: 1, appWindKt: 9, water: 2, dir: 0 }));
    render(<SpotReportBox spotId="cesantes" shownWindKt={11} shownVerdict="sailing" />);
    await waitFor(() => expect(screen.getByText('En el agua, hace 15 min · 2 reportes')).toBeTruthy());
    expect(screen.getByText('Más viento que los 9 kt de la app · algo de espuma · del N')).toBeTruthy();
    expect(screen.getByText(/comparado con los 11 kt/)).toBeTruthy();
  });

  it('without recent reports the card is only the question', async () => {
    const fetchMock = api({ ok: true, status: 201 }, null);
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="lourido" shownWindKt={8} shownVerdict="sailing" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/En el agua/)).toBeNull();
  });
});
