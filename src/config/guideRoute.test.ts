import { describe, it, expect } from 'vitest';
import {
  parseGuideTarget,
  guideShareUrl,
  GUIDE_SECTIONS,
  GUIDE_PATH,
} from './guideRoute';

describe('parseGuideTarget', () => {
  it('does not open the guide on the ordinary map URL', () => {
    expect(parseGuideTarget('/', '')).toEqual({
      open: false, section: 'intro', viaPath: false,
    });
  });

  it('opens at the introduction on the bare path', () => {
    expect(parseGuideTarget('/guia', '')).toEqual({
      open: true, section: 'intro', viaPath: true,
    });
  });

  it('tolerates a trailing slash, because people paste links with one', () => {
    expect(parseGuideTarget('/guia/', '').open).toBe(true);
    expect(parseGuideTarget('/guia/', '').section).toBe('intro');
  });

  it('opens the named section', () => {
    expect(parseGuideTarget('/guia/glossary', '')).toEqual({
      open: true, section: 'glossary', viaPath: true,
    });
  });

  it('opens the data section, which is the one an outsider is sent to', () => {
    expect(parseGuideTarget('/guia/datos', '').section).toBe('datos');
  });

  it('is case-insensitive: a link may travel through a mail client that lowercases it', () => {
    expect(parseGuideTarget('/GUIA/Glossary', '').section).toBe('glossary');
  });

  it('still opens — at the introduction — when the section does not exist', () => {
    // Bouncing someone who followed a link is worse than ignoring a typo.
    expect(parseGuideTarget('/guia/inventada', '')).toEqual({
      open: true, section: 'intro', viaPath: true,
    });
  });

  it('honours the older hash form that the modal has been writing all along', () => {
    expect(parseGuideTarget('/', '#guia/legal')).toEqual({
      open: true, section: 'legal', viaPath: false,
    });
  });

  it('ignores an unrelated hash', () => {
    expect(parseGuideTarget('/', '#seccion-cualquiera').open).toBe(false);
  });

  it('does not mistake a path that merely starts with the same letters', () => {
    // '/guiaX' is not the guide; only '/guia' or '/guia/...'.
    expect(parseGuideTarget('/guiaburros', '').open).toBe(false);
  });

  it('the path wins over the hash when both are present', () => {
    expect(parseGuideTarget('/guia/roadmap', '#guia/legal').section).toBe('roadmap');
  });
});

describe('guideShareUrl', () => {
  it('drops the redundant /intro so the shared link is the short one', () => {
    expect(guideShareUrl('intro', 'https://x.example')).toBe('https://x.example/guia');
  });

  it('keeps any other section in the path', () => {
    expect(guideShareUrl('datos', 'https://x.example')).toBe('https://x.example/guia/datos');
  });

  it('round-trips: whatever it builds, the parser reopens at the same section', () => {
    for (const s of GUIDE_SECTIONS) {
      const url = new URL(guideShareUrl(s.id, 'https://x.example'));
      expect(parseGuideTarget(url.pathname, '').section).toBe(s.id);
    }
  });
});

describe('GUIDE_SECTIONS', () => {
  it('has unique ids, or the round trip would silently pick the wrong one', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no id that would collide with the path segment itself', () => {
    expect(GUIDE_SECTIONS.some((s) => `/${s.id}` === GUIDE_PATH)).toBe(false);
  });
});
