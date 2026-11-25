/** The share dialog is modal (P3 review, batch 2, 19-nov): it takes the focus, keeps it, and gives it back. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../services/shareImageGenerator', async (orig) => ({
  ...(await orig<typeof import('../../services/shareImageGenerator')>()),
  renderShareCanvas: () => {},
}));

import { ShareSpotModal } from './ShareSpotModal';
import { ALL_SPOTS } from '../../config/spots';
import type { SpotScore } from '../../services/spotScoringEngine';

const spot = ALL_SPOTS.find((s) => s.id === 'cesantes')!;
const score = {
  spotId: 'cesantes', spotName: 'Cesantes', verdict: 'sailing', score: 50, summary: 'Navegable', provisional: false,
  wind: { stationCount: 3, avgSpeedKt: 9, rawAvgSpeedKt: 9, dominantDir: 'SW', dirDeg: 225 }, windDirDeg: 225,
  effectiveWindKt: 9, gustKt: 12, hardGateTriggered: null, computedAt: new Date(),
} as unknown as SpotScore;

describe('the share dialog', () => {
  it('opens with the focus inside and hands it back on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    try {
      const view = render(<ShareSpotModal spot={spot} score={score} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog', { name: /Compartir/ });
      expect(dialog.contains(document.activeElement)).toBe(true);
      view.unmount();
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });
});
