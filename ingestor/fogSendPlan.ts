/**
 * Which camera fog verdicts of an analysis cycle go out as a fog message, and why the others do not.
 * Pure, so the rules are tested here; webcamAnalyzer.ts runs the plan and sends.
 *
 * A verdict goes out only when, in this order:
 *  · it is fog with visibility 'poor' on a camera tied to a spot;
 *  · the camera can judge sea fog (not a mountain camera: Castrove sits inside the low cloud) and its
 *    fog verdicts are reliable (not Ons Praia, whose glass mists over);
 *  · the low sun is not in front of it (a washed-out image reads as fog);
 *  · no fresh camera of the same site sees clear (two cameras on one mast disagreeing = glass, not fog);
 *  · the stations around it corroborate it (fogCorroborated, checked before the model ran);
 *  · its site has not already had a message this cycle (one place, one message).
 */
import { RIAS_WEBCAMS, webcamSite, isSeaFogCamera, isFogUnreliable } from '../src/config/webcams.js';
import { summarizeFogBySite, sunInView } from '../src/services/webcamFogSites.js';

/** How old a sibling camera's verdict may be and still speak for its site (the map uses 30 min too). */
export const SITE_FRESH_MS = 30 * 60_000;

export interface CameraVerdict {
  webcamId: string;
  spotId: string | null;
  fog: boolean;
  visibility: string;
  analyzedAt: Date;
}

export interface FogSendDecision {
  webcamId: string;
  spotId: string;
  site: string;
  camName: string;
  send: boolean;
  /** Why it is not sent (empty when it is). */
  reason: string;
}

const CAMS = new Map(RIAS_WEBCAMS.map((w) => [w.id, w]));

/** Whether a camera's verdict may speak for its site at this moment. */
function canJudge(id: string, ms: number): boolean {
  const cam = CAMS.get(id);
  return isSeaFogCamera(id) && !(cam && sunInView(cam, ms));
}

export function planFogMessages(
  results: readonly CameraVerdict[],
  latestByCamera: ReadonlyMap<string, CameraVerdict | null>,
  gates: ReadonlyMap<string, { ok: boolean; reason: string }>,
  nowMs: number,
): FogSendDecision[] {
  // What each site says right now, from its cameras' latest verdicts. An unreliable camera's fog does
  // not count; its clear does (a clear horizon is not a misted glass).
  const fresh: { id: string; fog: boolean }[] = [];
  for (const [id, v] of latestByCamera) {
    if (!v || nowMs - v.analyzedAt.getTime() > SITE_FRESH_MS) continue;
    if (!canJudge(id, v.analyzedAt.getTime())) continue;
    if (v.fog && isFogUnreliable(id)) continue;
    fresh.push({ id, fog: v.fog });
  }
  const siteState = summarizeFogBySite(fresh, webcamSite).sites;

  const out: FogSendDecision[] = [];
  const sentSites = new Set<string>();
  for (const r of results) {
    if (!(r.fog && r.visibility === 'poor' && r.spotId)) continue;
    const site = webcamSite(r.webcamId);
    const camName = CAMS.get(r.webcamId)?.name ?? r.webcamId;
    const d = { webcamId: r.webcamId, spotId: r.spotId, site, camName };
    if (sentSites.has(site)) continue;
    if (!isSeaFogCamera(r.webcamId)) { out.push({ ...d, send: false, reason: 'camara de monte: puede estar dentro de la nube baja' }); continue; }
    if (isFogUnreliable(r.webcamId)) { out.push({ ...d, send: false, reason: 'su niebla no es fiable (cristal que se empaña)' }); continue; }
    const cam = CAMS.get(r.webcamId);
    if (cam && sunInView(cam, r.analyzedAt.getTime())) { out.push({ ...d, send: false, reason: 'el sol bajo de frente la deslumbra' }); continue; }
    if (siteState.get(site) === 'mixed') { out.push({ ...d, send: false, reason: 'otra camara del mismo sitio no la ve' }); continue; }
    const gate = gates.get(r.webcamId) ?? { ok: false, reason: 'sin comprobar las estaciones' };
    if (!gate.ok) { out.push({ ...d, send: false, reason: gate.reason }); continue; }
    sentSites.add(site);
    out.push({ ...d, send: true, reason: '' });
  }
  return out;
}
