import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasetResponse } from '../api/contract';
import { useDataset } from './useDataset';

const DATASET: DatasetResponse = {
  station: 'JUAN CARLOS I',
  stationId: '89064',
  start: '2026-11-08T13:00:00+01:00',
  end: '2026-11-15T13:00:00+01:00',
  timezone: 'Europe/Madrid',
  aggregation: 'none',
  types: ['temperature', 'pressure', 'speed'],
  count: 1,
  data: [
    { datetime: '2026-11-15T12:00:00+01:00', granularity: 'observation', samples: 1, temperature: 1.2, pressure: 987.6, speed: 4.5 },
  ],
  stale: false,
  partial: false,
  lastSyncedAt: '2026-11-15T13:00:00+01:00',
};

type FetchCall = { url: string; signal: AbortSignal };

function mockFetch() {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, signal: init.signal as AbortSignal });
      return new Response(JSON.stringify(DATASET), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDataset', () => {
  it('fetches the dataset for the given URL and reports success', async () => {
    mockFetch();

    const { result } = renderHook(() => useDataset('/api/datos/fechaini/a/fechafin/b/estacion/89064'));

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data?.stationId).toBe('89064');
    expect(result.current.error).toBeNull();
  });

  it('aborts the in-flight request when the URL changes', async () => {
    const calls = mockFetch();

    const { result, rerender } = renderHook(({ url }: { url: string } = { url: '/a' }) => useDataset(url));
    rerender({ url: '/b' });

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
  });

  it('stays idle (no fetch) while the URL is null', () => {
    const calls = mockFetch();
    const { result } = renderHook(() => useDataset(null));

    expect(result.current.status).toBe('idle');
    expect(calls).toHaveLength(0);
  });
});
