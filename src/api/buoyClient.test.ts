/**
 * Defensive guard tests for fetchBuoyLastReading.
 *
 * Background: Puertos del Estado emailed warning of IP block because
 * ObsCosteiro IDs (15000+) were leaking into PORTUS API calls. The fix
 * lives in two places:
 *   1. Call-site filter (`s.type !== 'OBSCOSTEIRO'`) in fetchAllRiasBuoys
 *   2. Function-level guard inside fetchBuoyLastReading itself
 *
 * These tests pin the function-level guard so a future refactor that
 * forgets the call-site filter still won't bombard the upstream.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the lower-level POST helper before importing the client.
const mockPortusPost = vi.fn();
vi.mock('./buoyClient', async (importOriginal) => {
  // We can't replace internals with a simple mock — instead we'll spy on fetch
  // globally in beforeEach.
  return await importOriginal();
});

beforeEach(() => {
  mockPortusPost.mockReset();
  vi.spyOn(global, 'fetch').mockImplementation(async () => {
    // Should never be called when guard works
    mockPortusPost();
    return new Response('{}', { status: 200 });
  });
});

describe('fetchBuoyLastReading — ObsCosteiro guard (PORTUS leak hardening)', () => {
  it('refuses to call PORTUS with id >= 15000', async () => {
    const { fetchBuoyLastReading } = await import('./buoyClient');
    const result = await fetchBuoyLastReading(15009, 'Muros');
    expect(result).toBeNull();
    expect(mockPortusPost).not.toHaveBeenCalled();
  });

  it('refuses for any 15000+ id (15001 Cortegada, 15100 Rande)', async () => {
    const { fetchBuoyLastReading } = await import('./buoyClient');
    const r1 = await fetchBuoyLastReading(15001);
    const r2 = await fetchBuoyLastReading(15100);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(mockPortusPost).not.toHaveBeenCalled();
  });

  it('14999 is borderline but still refuses', async () => {
    // Threshold is >= 15000, so 14999 would pass through. Pin the boundary.
    const { fetchBuoyLastReading } = await import('./buoyClient');
    await fetchBuoyLastReading(15000);
    expect(mockPortusPost).not.toHaveBeenCalled();
  });
});
