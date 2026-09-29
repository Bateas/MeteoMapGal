# Exam day: 29 September 2026

A southerly gale over the Rías Baixas (850 hPa at 50-69 kt, gusts to 61 kt at Cabo Udra) and a
cold front crossing Galicia between 18:50 and 20:40 local time. About twenty faults showed up
that day, each fixed with its own test. This folder freezes the day so that every future change
is checked against it: `exam.test.ts` replays the data below through the same functions
production runs.

## What the exam checks

| Case | What must come out |
|---|---|
| Strong-wind safety alert | One message when the gale starts and one more when it escalates; none after; the three restarts of the day do not repeat it |
| Quality control | No gust thrown away for its size (Cabo Udra 52-61 kt are real) |
| Opportunity alerts | Shut every hour while the front blows at 850 hPa |
| Wind patterns | No «Brisa SW (tardes)» in a gale (four spots named it before the fix) |
| Webcam fog | Not sent from one camera: the stations around Cangas at 15:29 rule it out |
| Rain forecast | 8.6 mm in the wettest hour is moderate rain, not PELIGRO |
| Rain in a window | A day counter jumping 10-50 mm every 5 min is not rain; the front's real rain is kept |
| Air-quality layer | Paints only the station that turned it on |
| Gust shown on a spot | From the last hour, not Vigo airport's reading of 73 minutes before |

Each case also checks that the frozen data contains its trap, and each was verified to fail
when its fix is undone.

## The data (`data.json`)

Extracted from the project's database on 29-sep-2026 at 22:10 CEST (readings end at ~22:05).
Times in UTC. Wind in m/s as measured, before quality control (the exam applies it), plus the
minutes each reading took to reach the database, so a replay only sees what the server could see.

- **MeteoGalicia** (Xunta de Galicia): 22 stations, the WRF rain forecast issued at 14:00 for
  the Rías sector, and the air-quality index (ICA) at 20:00. Licence CC BY-SA 4.0; this subset
  (selected rows, rounded) is distributed under the same licence. Fonte: MeteoGalicia.
- **AEMET**: 6 stations. Fuente: AEMET (Agencia Estatal de Meteorología).
- **Open-Meteo**: wind at 850 hPa over each sector, hourly. Weather data by Open-Meteo.com, CC BY 4.0.

Left out on purpose: home weather stations (Wunderground, Netatmo, Meteoclimatic), which sit
at people's houses; and buoys, whose terms (Puertos del Estado) require written permission to
redistribute. The broken rain gauge case uses an anonymised counter with the shape of the real one.

The code in this folder is MIT like the rest of the repository; `data.json` carries the
licences above.
