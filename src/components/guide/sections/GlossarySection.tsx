/**
 * Guide: glossary. Plain data with one line each, and a search that ignores accents. It only explains
 * words; what the app does with them is in the other sections, so no claim here can go out of date.
 */
import { useMemo, useState } from 'react';
import { H3, type Tone } from '../guideParts';
import type { IconId } from '../../icons/WeatherIcons';

type Term = [term: string, definition: string];

export const GLOSSARY: [group: string, terms: Term[]][] = [
  ['Viento', [
    ['Nudo (kt)', 'Unidad de velocidad en el mar. 1 nudo son 1,85 km/h.'],
    ['Dirección del viento', 'De dónde viene. Viento del norte es el que sopla desde el norte.'],
    ['Racha', 'Pico de pocos segundos por encima del viento medio.'],
    ['Factor de racha', 'La racha dividida entre el viento medio. Más de 2 es aire muy turbulento.'],
    ['Térmico', 'Viento local que crea el sol al calentar el valle o la tierra.'],
    ['Virazón', 'Brisa de mar de tarde.'],
    ['Nortada', 'Viento del norte o noroeste, típico del verano en Galicia.'],
    ['Terral', 'Viento de tierra hacia el mar, normalmente de madrugada y por la mañana.'],
    ['Barlovento y sotavento', 'Barlovento es el lado de donde viene el viento. Sotavento, el contrario.'],
    ['Frente de racha', 'Aire frío que sale de una tormenta y llega antes que ella, con rachas bruscas.'],
    ['Cizalladura', 'Cambio brusco del viento en poca distancia o altura.'],
  ]],
  ['Mar y mareas', [
    ['Pleamar y bajamar', 'El nivel más alto y el más bajo de la marea en cada ciclo, de unas 12 horas.'],
    ['Coeficiente de marea', 'De 20 a 120. Desde 70 son mareas vivas; por debajo de 45, muertas.'],
    ['Cero de la carta', 'El nivel desde el que se miden las alturas de la marea.'],
    ['Mar de fondo (swell)', 'Olas de tormentas lejanas. Largas, ordenadas y con periodo de más de 8 segundos.'],
    ['Periodo de ola', 'Segundos entre dos crestas. Cuanto más largo, más fuerza tiene la ola.'],
    ['Mar de viento', 'Olas cortas y desordenadas que levanta el viento de la zona.'],
    ['Mar cruzado', 'Olas de dos direcciones a la vez. Mar confuso.'],
    ['Offshore y onshore', 'Offshore: viento de tierra a mar, limpia las olas. Onshore: de mar a tierra, las estropea.'],
    ['Beach break y reef', 'Olas que rompen sobre arena, o sobre roca.'],
    ['Afloramiento', 'Agua fría del fondo que sube a la superficie cuando el norte aparta la de arriba.'],
  ]],
  ['Humedad y niebla', [
    ['Humedad relativa', 'Cuánto vapor tiene el aire respecto al máximo que admite. Con 100 % está saturado.'],
    ['Punto de rocío', 'Temperatura a la que el vapor se convierte en gotas.'],
    ['Diferencia T-Td (spread)', 'Temperatura menos punto de rocío. Cuanto más baja, más cerca de la niebla.'],
    ['Inversión térmica', 'Cuando arriba hace más calor que abajo. Atrapa niebla y humo en el valle.'],
    ['Calima', 'Polvo en el aire, a menudo del Sáhara, que enturbia el cielo.'],
  ]],
  ['Tormentas', [
    ['CAPE', 'Energía disponible para que el aire suba, en J/kg. A más CAPE, tormentas más fuertes si llegan a formarse.'],
    ['CIN', 'La tapa que frena esa subida. Con CIN alta cuesta que arranque.'],
    ['Índice de elevación (LI)', 'Si es negativo, el aire es inestable y tiende a subir.'],
    ['Capa límite (PBL)', 'La capa de aire que se mezcla con el suelo. Más alta, térmicas más potentes.'],
    ['Cumulonimbus', 'La nube de tormenta, que puede pasar de 12 km de altura.'],
    ['Corriente de un rayo (kA)', 'Intensidad del rayo, en kiloamperios.'],
    ['Reflectividad (dBZ)', 'Lo que ve el radar. 15 es llovizna; 35, lluvia moderada; más de 50, tormenta fuerte.'],
    ['Presión (hPa)', 'El peso del aire. Si cae rápido, suele acercarse un frente.'],
  ]],
  ['Temperatura', [
    ['Índice de calor', 'Temperatura que se siente con calor y humedad.'],
    ['Sensación por viento', 'Temperatura que se siente con frío y viento.'],
  ]],
  ['Datos y modelos', [
    ['Medida y modelo', 'Una medida viene de un sensor. Un modelo es un cálculo por ordenador, y puede fallar.'],
    ['WRF', 'Modelo de previsión del tiempo. MeteoGalicia lo calcula a 1 km.'],
    ['SWAN', 'Modelo de olas cerca de la costa.'],
    ['METAR', 'Parte de observación de los aeropuertos, con la visibilidad.'],
    ['NAO', 'Diferencia de presión entre Islandia y Azores. Si es negativa, más borrascas suelen llegar a Galicia.'],
  ]],
];

const GROUP_ICON: Record<string, [IconId, Tone]> = {
  Viento: ['wind', 'wind'],
  'Mar y mareas': ['waves', 'sea'],
  'Humedad y niebla': ['fog', 'fog'],
  Tormentas: ['zap', 'storm'],
  Temperatura: ['thermometer', 'fire'],
  'Datos y modelos': ['database', 'rain'],
};

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function GlossarySection() {
  const [search, setSearch] = useState('');
  const q = normalize(search);
  const groups = useMemo(() => GLOSSARY
    .map(([group, terms]) => [group, terms.filter(([t, d]) => !q || normalize(`${t} ${d}`).includes(q))] as const)
    .filter(([, terms]) => terms.length > 0), [q]);
  const count = groups.reduce((n, [, terms]) => n + terms.length, 0);

  return (
    <div className="g-theme gg-page">
      <h2>Glosario</h2>
      <p>Las palabras de la app y de esta guía, en una línea.</p>

      <div className="gg-search">
        <label htmlFor="gg-glossary-search">Buscar un término</label>
        <input id="gg-glossary-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        <p role="status" className="gg-muted gg-small">
          {!q ? `${count} términos` : count === 0 ? `Ninguno con «${search.trim()}». Prueba con otra palabra.` : `${count} con «${search.trim()}»`}
        </p>
      </div>

      {groups.map(([group, terms]) => (
        <section key={group} className="gg-section">
          <H3 id={GROUP_ICON[group][0]} tone={GROUP_ICON[group][1]}>{group}</H3>
          <dl className="gg-defs gg-defs-tight">
            {terms.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}
          </dl>
        </section>
      ))}
    </div>
  );
}
