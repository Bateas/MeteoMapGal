/**
 * The rewritten guide: every section renders in both sectors with the shared style, the figures it
 * states match the engines, and the navigation works without a mouse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MeteoGuide } from './MeteoGuide';
import { QuickStartSection } from './sections/QuickStartSection';
import { ReadingMapSection } from './sections/ReadingMapSection';
import { DataSection } from './sections/DataSection';
import { SpotScoringSection, WAVE_SCALE } from './sections/SpotScoringSection';
import { ThermalCastreloSection } from './sections/ThermalCastreloSection';
import { RiasBaixasSection } from './sections/RiasBaixasSection';
import { CampoPanelSection } from './sections/CampoPanelSection';
import { HistorySection } from './sections/HistorySection';
import { GlossarySection, GLOSSARY } from './sections/GlossarySection';
import { RoadmapSection } from './sections/RoadmapSection';
import { LegalSection } from './sections/LegalSection';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { SECTORS } from '../../config/sectors';
import { getSpotsForSector } from '../../config/spots';
import { computeSurfVerdict } from '../../services/surfVerdictEngine';
import { checkFrost, rainLevelForHours } from '../../services/fieldAlertEngine';
import type { HourlyForecast } from '../../types/forecast';

const SECTIONS = { QuickStartSection, ReadingMapSection, DataSection, SpotScoringSection, ThermalCastreloSection, RiasBaixasSection, CampoPanelSection, HistorySection, GlossarySection, RoadmapSection, LegalSection };

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
});

describe('the sections', () => {
  const cases = SECTORS.flatMap((s) => Object.keys(SECTIONS).map((name) => [s.id, name] as const));

  it.each(cases)('%s: %s renders in the shared style', (sectorId, name) => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === sectorId)! });
    const Section = SECTIONS[name as keyof typeof SECTIONS];
    const { container } = render(<Section />);
    expect(container.querySelector('h2')).toBeTruthy();
    expect(container.querySelector('.gg-page')).toBeTruthy();
    // The old classes are dark-only and small: nothing here should still use them.
    expect(container.innerHTML).not.toMatch(/text-slate|bg-slate|text-\[1[01]px\]/);
  });

  it.each(SECTORS.map((s) => s.id))('lists every spot of %s, read from the configuration', (sectorId) => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === sectorId)! });
    render(<SpotScoringSection />);
    for (const spot of getSpotsForSector(sectorId)) expect(screen.getAllByText(spot.name).length).toBeGreaterThan(0);
  });

  it('the legal notice keeps the holders and the licences', () => {
    const { container } = render(<LegalSection />);
    const text = container.textContent ?? '';
    for (const s of ['© AEMET', 'CC BY-SA 4.0', 'CC BY-NC-ND', 'Observatorio RAIA', 'portus.puertos.es', 'observatoriocosteiro.gal', 'no sustituye', 'Cloudflare Web Analytics']) {
      expect(text).toContain(s);
    }
  });

  // What the V3 cut. A word here is a promise the app no longer keeps. The rose of the History tab stays.
  it.each(SECTORS.flatMap((s) => Object.keys(SECTIONS).map((name) => [s.id, name] as const)))('%s: %s names nothing that was cut', (sectorId, name) => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === sectorId)! });
    useUIStore.setState({ alphaMode: false });
    const Section = SECTIONS[name as keyof typeof SECTIONS];
    const { container } = render(<Section />);
    expect(container.textContent).not.toMatch(/Rankings|Comparador|Modo Evento|Regata|ventana mágica|ET₀|Fitosanitario|Grados-día|Mildiu|Oídio|NOTAM|ZGUAS|batimetría|señales marítimas|curvas de nivel|ortofoto|aeronaves|gráficas y/i);
    expect(container.textContent).not.toContain('«Capas»');
  });

  it.each(['EMODnet', 'OpenSeaMap', 'OpenSky', 'Copernicus Marine', 'CMEMS', 'CARTO', 'ENAIRE'])('%s is no longer credited: nothing asks it for data', (provider) => {
    for (const Section of [LegalSection, RoadmapSection, DataSection]) {
      const { container, unmount } = render(<Section />);
      expect(container.textContent).not.toContain(provider);
      unmount();
    }
  });

  it.each(['Esri', 'OpenStreetMap', 'IGN', 'RainViewer', 'IHM', 'CESGA', 'Open-Meteo', 'NASA FIRMS', 'EFFIS', 'NOAA', 'Protomaps', 'Amazon'])('%s stays credited', (provider) => {
    const { container } = render(<LegalSection />);
    expect(container.textContent).toContain(provider);
  });

  // LSSI-CE art. 10: the holder is named, and its identifying data are one link away, in the company's
  // own legal notice, linked rather than copied here (25-nov).
  it('names the holder and links to its legal notice, in a new tab', () => {
    const { container } = render(<LegalSection />);
    const text = container.textContent ?? '';
    expect(text).toContain('Titular');
    expect(text).toContain('Vortal XR, S.L.');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href="https://forxaxr.com/es/legal/aviso-legal/"]')];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    }
    // The holder comes first: it is what the law asks to find at once
    expect(container.querySelector('h3')?.textContent).toBe('Titular');
    // and the privacy part says who answers for the data
    const privacy = [...container.querySelectorAll('section')].find((s) => s.querySelector('h3')?.textContent === 'Privacidad');
    expect(privacy?.textContent).toContain('Responsable');
    expect(privacy?.querySelector('a[href="https://forxaxr.com/es/legal/aviso-legal/"]')).toBeTruthy();
    // The notice points to the company's own legal page and does not name a brand of it.
    expect(text).not.toMatch(/navia3d/i);
  });

  // The radar on the map is RainViewer's alone since the AEMET image was dropped: each row credits what it gives.
  it('the radar is credited to RainViewer, and to nobody else', () => {
    const { container } = render(<LegalSection />);
    const rows = [...container.querySelectorAll('li')].filter((li) => /radar/i.test(li.textContent ?? ''));
    expect(rows.map((li) => li.querySelector('b')?.textContent)).toEqual(['RainViewer']);
  });

  it('the sources keep the notice that it is not for navigation', () => {
    const { container } = render(<RoadmapSection />);
    expect(container.textContent).toContain('NO APTO PARA NAVEGACIÓN MARÍTIMA NI AÉREA');
    expect(container.textContent).toContain('Powered by Weather Underground');
  });
});

describe('the figures the guide states', () => {
  it('the wave scale matches the engine at the middle of each band', () => {
    const heights = [0.2, 0.5, 1.2, 2, 3];
    WAVE_SCALE.forEach(([name], i) => {
      expect(computeSurfVerdict(heights[i], 6, false, false).label).toBe(name);
    });
  });

  const night = (over: Partial<HourlyForecast>): HourlyForecast[] => {
    const time = new Date(); time.setHours(3, 0, 0, 0);
    return [{ time, temperature: 10, cloudCover: 80, windSpeed: 5, precipitation: 0, precipProbability: 0, ...over } as HourlyForecast];
  };

  it.each([
    [2, 80, 5, 'riesgo'], [0, 80, 5, 'alto'], [0, 10, 1, 'critico'], [4, 10, 1, 'riesgo'], [2, 10, 1, 'alto'], [3, 80, 5, 'none'],
  ])('frost at %s °C, %s %% cloud, %s m/s is %s, as the table says', (temperature, cloudCover, windSpeed, level) => {
    expect(checkFrost(night({ temperature, cloudCover, windSpeed })).level).toBe(level);
  });

  it.each([
    [1.5, 0, 0, 'riesgo'], [0, 80, 0, 'riesgo'], [11, 0, 0, 'alto'], [3, 80, 0, 'alto'], [6, 0, 1200, 'critico'],
  ])('rain of %s mm/h, %s %%, CAPE %s is %s, as the table says', (precipitation, precipProbability, cape, level) => {
    expect(rainLevelForHours(night({ precipitation, precipProbability, cape }))).toBe(level);
  });
});

describe('the keys the guide lists', () => {
  it('are the ones the app answers to', async () => {
    const { SHORTCUTS } = await import('../common/KeyboardShortcutHelp');
    expect(SHORTCUTS.map((s) => s.key).sort()).toEqual(['?', 'C', 'Esc', 'G', 'P', 'R', 'T', 'W'].sort());
    const { container } = render(<ReadingMapSection />);
    const keys = [...container.querySelectorAll('.gg-keys kbd')].map((k) => k.textContent);
    expect(keys.sort()).toEqual(SHORTCUTS.map((s) => s.key).sort());
  });
});

describe('the glossary', () => {
  it('finds a term without its accent and says when nothing matches', () => {
    render(<GlossarySection />);
    const input = screen.getByLabelText('Buscar un término');
    fireEvent.change(input, { target: { value: 'termico' } });
    expect(screen.getByText('Térmico')).toBeTruthy();
    expect(screen.queryByText('Nudo (kt)')).toBeNull();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent).toContain('Ninguno con «zzzz»');
  });

  it('defines each term once', () => {
    const terms = GLOSSARY.flatMap(([, list]) => list.map(([t]) => t));
    expect(new Set(terms).size).toBe(terms.length);
  });
});

describe('the navigation', () => {
  beforeEach(() => {
    useSectorStore.setState({ activeSector: SECTORS.find((s) => s.id === 'rias')! });
    useUIStore.setState({ guideOpen: true, isMobile: false });
  });

  it('marks where you are, with real links', () => {
    render(<MeteoGuide />);
    const nav = screen.getByRole('navigation', { name: 'Secciones de la guía' });
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('En 1 minuto');
    expect(screen.getByRole('link', { name: 'Glosario' }).getAttribute('href')).toBe('/guia/glossary');
  });

  // 25-nov, with a screen reader on a phone: on changing section it read the name of the box and stopped.
  // The focus goes to the heading of the new section, the first thing in it, so reading goes on into the text.
  it('moves the focus to the heading of the new section, inside its region', () => {
    render(<MeteoGuide />);
    fireEvent.click(screen.getByRole('link', { name: 'Glosario' }));
    expect(screen.getByRole('link', { name: 'Glosario' }).getAttribute('aria-current')).toBe('page');
    const region = screen.getByRole('region', { name: 'Glosario' });
    const heading = region.querySelector('h2');
    expect(heading?.textContent).toBe('Glosario');
    expect(document.activeElement).toBe(heading);
    // Reachable by script, not a stop of its own for the Tab key
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    // Nothing before the heading inside the region: the reader starts at the top
    expect(region.querySelector('h2, h3, p, button, a')).toBe(heading);
  });

  it('every section starts with a heading to land on', () => {
    render(<MeteoGuide />);
    const links = screen.getByRole('navigation', { name: 'Secciones de la guía' }).querySelectorAll('a');
    expect(links.length).toBeGreaterThan(5);
    for (const link of Array.from(links)) {
      if (link.getAttribute('aria-current') === 'page') continue;
      fireEvent.click(link);
      expect(document.activeElement?.tagName, link.textContent ?? '').toBe('H2');
    }
  });

  it('the way out has a name on a phone too', () => {
    useUIStore.setState({ isMobile: true });
    render(<MeteoGuide />);
    expect(screen.getByRole('button', { name: 'Volver al mapa' })).toBeTruthy();
  });
});
