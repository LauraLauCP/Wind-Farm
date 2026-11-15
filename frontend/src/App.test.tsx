import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { DatasetResponse, EstacionesResponse } from './api/contract';

const STATIONS: EstacionesResponse = {
  count: 2,
  stations: [
    { id: '89064', name: 'JUAN CARLOS I', province: null, latitude: -62.66, longitude: -60.39 },
    { id: '89070', name: 'GABRIEL DE CASTILLA', province: null, latitude: -62.72, longitude: -61.12 },
  ],
};

const DATASET: DatasetResponse = {
  station: 'JUAN CARLOS I',
  stationId: '89064',
  start: '2026-11-08T13:00:00+01:00',
  end: '2026-11-15T13:00:00+01:00',
  timezone: 'Europe/Madrid',
  aggregation: 'none',
  types: ['temperature', 'pressure', 'speed'],
  count: 2,
  data: [
    { datetime: '2026-11-15T11:00:00+01:00', granularity: 'observation', samples: 1, temperature: 1.2, pressure: 987.6, speed: 4.5 },
    { datetime: '2026-11-15T12:00:00+01:00', granularity: 'observation', samples: 1, temperature: 1.4, pressure: 987.1, speed: 4.1 },
  ],
  stale: false,
  partial: false,
  lastSyncedAt: '2026-11-15T13:00:00+01:00',
};

/** Routes the stubbed fetch by path, capturing every URL for assertions. */
function mockApi(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = url.startsWith('/api/estaciones')
        ? STATIONS
        : url.includes('/api/datos/')
          ? DATASET
          : { error: { code: 'not_found', message: `unexpected url ${url}` } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return { urls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App (smoke)', () => {
  it('loads the default query on mount and renders the full pipeline', async () => {
    const { urls } = mockApi();
    render(<App />);

    // The station picker is searchable (combobox).
    expect(await screen.findByRole('combobox', { name: /station/i })).toBeInTheDocument();

    // The default query fires on mount: station 89064, Madrid wall times.
    await waitFor(() => {
      expect(urls.some((url) => url.includes('/api/datos/') && url.includes('estacion/89064'))).toBe(true);
    });

    // The dataset lands: station name, chart titles, table rows, cache status.
    expect(await screen.findByText('JUAN CARLOS I')).toBeInTheDocument();
    // The type appears as a chart title and as a table column header.
    expect(screen.getAllByText('Temperature (°C)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2026-11-15 12:00')).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/last synced/i)).toBeInTheDocument();
  });

  it('re-queries with the filters when the form is submitted', async () => {
    const { urls } = mockApi();
    render(<App />);

    const user = userEvent.setup();
    await screen.findByText('JUAN CARLOS I');

    await user.click(screen.getByRole('button', { name: 'Query' }));
    await waitFor(() => {
      expect(urls.filter((url) => url.includes('/api/datos/')).length).toBeGreaterThanOrEqual(2);
    });
  });
});
