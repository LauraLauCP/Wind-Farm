import { useState } from 'react';
import { ALL_DATA_TYPES, AGGREGATIONS, type Aggregation, type DataType, type PickerStation } from './api/contract';
import { buildDatosQuery, type DatasetFilters } from './api/datosQuery';
import { CacheStatus } from './components/CacheStatus';
import { DatasetChart } from './components/DatasetChart';
import { DatasetTable } from './components/DatasetTable';
import { StationPicker } from './components/StationPicker';
import { useDataset } from './hooks/useDataset';
import { DEFAULT_LOCATION, defaultRange } from './lib/dates';
import { AGGREGATION_LABEL, TYPE_META } from './lib/display';

/** The agreed defaults: Juan Carlos I, last 7 days, native granularity. */
function defaultFilters(): DatasetFilters {
  const range = defaultRange(new Date());
  return {
    stationId: '89064',
    start: range.start,
    end: range.end,
    aggregation: 'none',
    types: ALL_DATA_TYPES,
    location: DEFAULT_LOCATION,
  };
}

export default function App() {
  const [form, setForm] = useState<DatasetFilters>(() => defaultFilters());
  const [station, setStation] = useState<PickerStation | null>({
    id: '89064',
    name: 'JUAN CARLOS I',
    province: null,
    latitude: -62.66,
    longitude: -60.39,
  });
  const [submitted, setSubmitted] = useState<DatasetFilters>(() => defaultFilters());
  const dataset = useDataset(buildDatosQuery(submitted));

  const toggleType = (type: DataType) => {
    setForm((previous) => ({
      ...previous,
      types: previous.types.includes(type)
        ? previous.types.filter((t) => t !== type)
        : [...previous.types, type],
    }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = { ...form, stationId: station?.id ?? form.stationId };
    // Same query → the URL wouldn't change, so the hook would not refetch;
    // an explicit "Query" press means the user wants fresh data.
    if (buildDatosQuery(next) === buildDatosQuery(submitted)) {
      dataset.reload();
    } else {
      setSubmitted(next);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Wind Farm — AEMET data</h1>
        <p>Weather measurements for the Antarctic wind farm feasibility study.</p>
      </header>

      <form className="filters" onSubmit={submit} aria-label="Query filters">
        <div className="filters__field">
          <label>Station</label>
          <StationPicker selected={station} onSelect={setStation} />
        </div>

        <div className="filters__field">
          <label htmlFor="start">Datetime start</label>
          <input
            id="start"
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM-DDTHH:MM:SS"
            value={form.start}
            onChange={(event) => setForm((previous) => ({ ...previous, start: event.target.value }))}
          />
        </div>

        <div className="filters__field">
          <label htmlFor="end">Datetime end</label>
          <input
            id="end"
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM-DDTHH:MM:SS"
            value={form.end}
            onChange={(event) => setForm((previous) => ({ ...previous, end: event.target.value }))}
          />
        </div>

        <div className="filters__field">
          <label htmlFor="aggregation">Time aggregation</label>
          <select
            id="aggregation"
            value={form.aggregation}
            onChange={(event) => setForm((previous) => ({ ...previous, aggregation: event.target.value as Aggregation }))}
          >
            {AGGREGATIONS.map((aggregation) => (
              <option key={aggregation} value={aggregation}>
                {AGGREGATION_LABEL[aggregation]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="filters__field filters__types">
          <legend>Data types</legend>
          {ALL_DATA_TYPES.map((type) => (
            <label key={type} className="filters__type">
              <input
                type="checkbox"
                checked={form.types.includes(type)}
                onChange={() => toggleType(type)}
              />
              {TYPE_META[type].label} ({TYPE_META[type].unit})
            </label>
          ))}
        </fieldset>

        <div className="filters__field">
          <label htmlFor="location">Timezone (IANA)</label>
          <input
            id="location"
            type="text"
            placeholder="Europe/Madrid"
            value={form.location}
            onChange={(event) => setForm((previous) => ({ ...previous, location: event.target.value }))}
          />
          <span className="filters__hint">How the start/end times above are interpreted.</span>
        </div>

        <button type="submit" className="filters__submit">
          Query
        </button>
      </form>

      <main className="results" aria-live="polite">
        {dataset.status === 'loading' && <p className="results__state">Loading…</p>}

        {dataset.status === 'error' && (
          <div className="results__error" role="alert">
            <p>{dataset.error}</p>
            <button type="button" onClick={dataset.reload}>
              Retry
            </button>
          </div>
        )}

        {dataset.status === 'success' && dataset.data !== null && (
          <>
            <CacheStatus dataset={dataset.data} />
            {dataset.data.count === 0 ? (
              <p className="results__state">No data for this range and station.</p>
            ) : (
              <>
                <section className="results__section" aria-label="Charts">
                  <h2>Time series</h2>
                  <DatasetChart dataset={dataset.data} />
                </section>
                <section className="results__section" aria-label="Table">
                  <h2>Data table</h2>
                  <DatasetTable dataset={dataset.data} />
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
