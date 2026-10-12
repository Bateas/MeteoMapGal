/**
 * How our server introduces itself to the data providers (User-Agent).
 *
 * MeteoGalicia audits request efficiency by IP and Puertos del Estado knows us
 * by this exact string (we described it to them in writing on 30-sep-2026), so
 * every request the server makes to them carries it. Do not change it without
 * telling them. Server only: browsers do not let a page set this header.
 */
export const SERVER_USER_AGENT = 'Mozilla/5.0 (compatible; MeteoMapGal/1.0; +https://meteomapgal.navia3d.com)';
