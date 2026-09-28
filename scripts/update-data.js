const fs = require('fs');
const path = require('path');

const API = 'https://opendata.kosava.cloud/api/v1';
const OUT_DIR = path.join(__dirname, '..', 'data');
const DAYS = [7, 30];
const STATION_IDS = ['36', '37', '38', '106'];
const PARAMETERS = ['PM10', 'PM2.5', 'NO2', 'SO2', 'O3'];

const CATEGORIES = [
  { key: 'good', label: 'Dobar', max: { SO2: 20, PM10: 15, O3: 60, NO2: 10, 'PM2.5': 5 } },
  { key: 'acceptable', label: 'Prihvatljiv', max: { SO2: 40, PM10: 45, O3: 100, NO2: 25, 'PM2.5': 15 } },
  { key: 'moderate', label: 'Umeren', max: { SO2: 125, PM10: 120, O3: 120, NO2: 60, 'PM2.5': 50 } },
  { key: 'polluted', label: 'Zagađen', max: { SO2: 190, PM10: 195, O3: 160, NO2: 100, 'PM2.5': 90 } },
  { key: 'very-polluted', label: 'Veoma zagađen', max: { SO2: 275, PM10: 270, O3: 180, NO2: 150, 'PM2.5': 140 } },
  { key: 'extreme', label: 'Izuzetno zagađen', max: { SO2: Infinity, PM10: Infinity, O3: Infinity, NO2: Infinity, 'PM2.5': Infinity } },
];

function classify(parameter, value) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (value <= CATEGORIES[i].max[parameter]) return { rank: i, ...CATEGORIES[i] };
  }
  return { rank: CATEGORIES.length - 1, ...CATEGORIES[CATEGORIES.length - 1] };
}

function localDate(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(iso));
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function localTime(iso) {
  return new Intl.DateTimeFormat('sr-RS', {
    timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(iso));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('sr-Latn-RS', {
    timeZone: 'Europe/Belgrade', weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date(`${date}T12:00:00+02:00`));
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}`); }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const meta = await getJson(`${API}/metadata`);
  if (meta.data_status !== 'preliminary') {
    console.warn(`API data_status is ${meta.data_status}; frontend will use the returned status.`);
  }

  const stations = await getJson(`${API}/stations?active=true`);
  const stationMap = new Map(stations.map(s => [String(s.station_id), s]));
  const nisStations = STATION_IDS.map(id => stationMap.get(id)).filter(Boolean);
  if (nisStations.length !== STATION_IDS.length) {
    throw new Error(`Not all configured Niš stations were found. Found: ${nisStations.map(s => s.station_id).join(', ')}`);
  }

  const generatedAt = new Date().toISOString();
  const from30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = generatedAt;

  const observations = [];
  for (const stationId of STATION_IDS) {
    const url = new URL(`${API}/observations`);
    url.searchParams.set('station_id', stationId);
    url.searchParams.set('from', from30);
    url.searchParams.set('to', to);
    const payload = await getJson(url);
    if (!Array.isArray(payload.data)) throw new Error(`Unexpected observations response for station ${stationId}`);
    for (const row of payload.data) {
      if (PARAMETERS.includes(row.parameter_code) && Number.isFinite(Number(row.value))) {
        observations.push({
          station_id: String(row.station_id),
          parameter_code: row.parameter_code,
          time_start_utc: row.time_start_utc,
          time_end_utc: row.time_end_utc,
          value: Number(row.value),
          unit: row.unit,
          data_status: row.data_status || meta.data_status,
          aggregation_type: row.aggregation_type || meta.aggregation_type,
          coverage: row.coverage ?? null,
        });
      }
    }
  }

  if (!observations.length) throw new Error('No Niš observations returned; refusing to overwrite existing data.');

  const stationInfo = Object.fromEntries(nisStations.map(s => [String(s.station_id), {
    station_id: String(s.station_id), name: s.station_name, code: s.station_code, municipality: s.municipality
  }]));

  observations.sort((a, b) => new Date(a.time_start_utc) - new Date(b.time_start_utc));
  const byDay = new Map();
  for (const row of observations) {
    const date = localDate(row.time_start_utc);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(row);
  }

  const allDays = [...byDay.keys()].sort().reverse();
  const buildFeed = days => {
    const selected = allDays.slice(0, days).sort();
    const daily = selected.map(date => {
      const rows = byDay.get(date) || [];
      const pollutants = {};
      let worst = null;
      for (const parameter of PARAMETERS) {
        const values = rows.filter(r => r.parameter_code === parameter);
        if (!values.length) continue;
        const maxRow = values.reduce((a, b) => b.value > a.value ? b : a);
        const category = classify(parameter, maxRow.value);
        pollutants[parameter] = {
          value: maxRow.value,
          unit: maxRow.unit,
          aggregation: 'maksimum z dostupnih satnih sredina tog dana',
          samples: values.length,
          time_local: localTime(maxRow.time_start_utc),
          station_id: maxRow.station_id,
          station_name: stationInfo[maxRow.station_id]?.name || maxRow.station_id,
          data_status: maxRow.data_status,
          category: { key: category.key, label: category.label, rank: category.rank }
        };
        if (!worst || category.rank > worst.rank) {
          worst = { ...category, parameter, value: maxRow.value, station_id: maxRow.station_id };
        }
      }
      const statuses = rows.map(r => r.data_status).filter(Boolean);
      return {
        date,
        date_label: formatDate(date),
        indicator: worst ? {
          key: worst.key, label: worst.label, rank: worst.rank,
          pollutant: worst.parameter, value: worst.value,
          station_id: worst.station_id
        } : null,
        pollutants,
        stations_with_data: [...new Set(rows.map(r => r.station_id))],
        observation_count: rows.length,
        data_status: statuses.includes('preliminary') ? 'preliminary' : (statuses[0] || meta.data_status)
      };
    });

    return {
      generated_at_utc: generatedAt,
      timezone: 'Europe/Belgrade',
      period_days: days,
      source: 'SEPA / Kosava Open Data API',
      source_url: `${API}/observations`,
      data_status: meta.data_status,
      aggregation_type: meta.aggregation_type,
      stations: nisStations.map(s => stationInfo[String(s.station_id)]),
      parameters: PARAMETERS,
      methodology: {
        indicator: 'Aplikacioni indikator, nije zvanični SEPA indeks.',
        daily_value: 'Za svaki polutant prikazana je najveća dostupna satna sredina tokom lokalnog dana, a dnevna kategorija je najviša kategorija među dostupnim polutantima i stanicama tog dana.',
        thresholds_source: 'SEPA indeks kvaliteta vazduha: satni pragovi za SO2, PM10, O3, NO2 i PM2.5.',
        missing_data: 'Parametri bez merenja nisu popunjeni niti interpolirani.'
      },
      days: daily
    };
  };

  const feeds = [7, 30].map(days => [days, buildFeed(days)]);
  for (const [days, feed] of feeds) {
    const target = path.join(OUT_DIR, `nis-${days}d.json`);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(feed, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, target);
    console.log(`Wrote ${target} (${feed.days.length} days, ${observations.length} observations scanned).`);
  }
}

main().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
