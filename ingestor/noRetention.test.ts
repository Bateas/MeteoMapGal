/**
 * Our data is kept: observations, field reports, predictions and scores are the history every check
 * and every model is built on (decided 30-oct-2026, when five tables were found with a 2-year
 * retention policy added by hand). This fails if schema.sql adds a retention policy or drops chunks,
 * and if it stops removing the five that existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(path.join(HERE, 'schema.sql'), 'utf8');
const code = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

describe('schema.sql keeps our data', () => {
  it('never adds a retention policy nor drops chunks', () => {
    expect(code).not.toMatch(/add_retention_policy|drop_chunks/i);
  });

  it('removes the five policies that had been added by hand', () => {
    for (const t of ['readings', 'convection_grid_hourly', 'storm_predictions', 'lightning_strikes', 'spot_scores']) {
      expect(code).toContain(`remove_retention_policy('${t}', if_exists => TRUE)`);
    }
  });
});
