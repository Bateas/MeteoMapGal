import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SpotReportBox } from './SpotReportBox';
import { __clearRecentReportsCacheForTests, __clearObserverCacheForTests } from '../../api/fieldReportClient';

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
    fireEvent.click(screen.getByText('Más viento'));
    fireEvent.click(screen.getByText('Mucha espuma'));
    fireEvent.click(screen.getByText('SO'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias/)).toBeTruthy());
    expect(postBody(fetchMock)).toMatchObject({ spotId: 'cesantes', windVsApp: 1, waterState: 3, dirSeen: 225, appWindKt: 12.4, appVerdict: 'good' });
    unmount();

    render(<SpotReportBox spotId="cesantes" shownWindKt={12.4} shownVerdict="good" />);
    expect(screen.getByText(/Ya enviaste un reporte/)).toBeTruthy();
    expect(screen.queryByText('Más viento')).toBeNull();
  });

  it('sends with only the wind answer, the other two are optional', async () => {
    const fetchMock = api({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    fireEvent.click(screen.getByText('Menos viento'));
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

  it('asks again before sending «Menos viento» with foam when the app shows under 8 kt', () => {
    render(<SpotReportBox spotId="cesantes" shownWindKt={6.8} shownVerdict="light" />);
    fireEvent.click(screen.getByText('Menos viento'));
    fireEvent.click(screen.getByText('Algo de espuma'));
    expect(screen.getByText(/¿Querías decir «Más viento»\?/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sí, más viento'));
    expect(screen.queryByText(/¿Querías decir/)).toBeNull();
    expect(screen.getByText('Más viento').getAttribute('aria-pressed')).toBe('true');
  });

  it('without recent reports the card is only the question', async () => {
    const fetchMock = api({ ok: true, status: 201 }, null);
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="lourido" shownWindKt={8} shownVerdict="sailing" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/En el agua/)).toBeNull();
  });
});

describe('SpotReportBox with a personal observer code', () => {
  const route = (name: string | null) => vi.fn((url: string, init?: { method?: string; body?: string }) => {
    if (url === '/api/v1/observers/me') {
      return Promise.resolve(name
        ? { ok: true, status: 200, json: () => Promise.resolve({ name, reports: [{ time: Date.UTC(2026, 9, 15, 14, 5), spotId: 'cesantes', windVsApp: 1, waterState: 2, dirSeen: 225, ktLo: 12, ktHi: 16, appWindKt: 9 }] }) }
        : { ok: false, status: 404 });
    }
    if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 201 });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ summary: null }) });
  });
  beforeEach(() => { localStorage.clear(); __clearRecentReportsCacheForTests(); __clearObserverCacheForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says who is reporting, asks for knots and sends them; the diary is there', async () => {
    localStorage.setItem('mmg-observer', 'abcdefgh23456k');
    const fetchMock = route('Ana');
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    await waitFor(() => expect(screen.getByText('observador: Ana')).toBeTruthy());
    expect(screen.getByText('Tu zona de observador')).toBeTruthy();
    expect(screen.getByText(/12-16 kt · algo de espuma · del SO · la app decía 9/)).toBeTruthy();
    fireEvent.click(screen.getByText('Más viento'));
    fireEvent.click(screen.getByText('12-16 kt'));
    fireEvent.click(screen.getByText('Enviar'));
    await waitFor(() => expect(screen.getByText(/Gracias, Ana/)).toBeTruthy());
    const sent = fetchMock.mock.calls.find((c) => c[0] === '/api/v1/reports')!;
    expect(JSON.parse((sent[1] as { body: string }).body)).toMatchObject({ windVsApp: 1, ktRange: 3, observerCode: 'abcdefgh23456k' });
  });

  it('anonymous: no knots question and no knots sent; the code can be typed in', async () => {
    const fetchMock = route('Luis');
    vi.stubGlobal('fetch', fetchMock);
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    fireEvent.click(screen.getByText('Código de observador'));
    fireEvent.change(screen.getByLabelText('Código de observador'), { target: { value: 'https://meteomapgal.com/?obs=abcdefgh23456k' } });
    fireEvent.click(screen.getByText('Guardar'));
    await waitFor(() => expect(screen.getByText('observador: Luis')).toBeTruthy());
  });

  it('a code the server does not know says so and the box stays anonymous', async () => {
    vi.stubGlobal('fetch', route(null));
    render(<SpotReportBox spotId="cesantes" shownWindKt={9} shownVerdict="sailing" />);
    fireEvent.click(screen.getByText('Código de observador'));
    fireEvent.change(screen.getByLabelText('Código de observador'), { target: { value: 'abcdefgh23456k' } });
    fireEvent.click(screen.getByText('Guardar'));
    await waitFor(() => expect(screen.getByText(/no existe o está desactivado/)).toBeTruthy());
    fireEvent.click(screen.getByText('Igual'));
    expect(screen.queryByText('12-16 kt')).toBeNull();
  });
});
