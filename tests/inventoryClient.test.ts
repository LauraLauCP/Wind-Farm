import { afterEach, describe, expect, it, vi } from 'vitest';
import { AemetInventoryClient } from '../src/client/inventoryClient.js';

const ENVELOPE_URL =
  'https://aemet.example.test/opendata/api/valores/climatologicos/inventarioestaciones/todasestaciones?api_key=test-api-key';
const DATA_URL = 'https://opendata.aemet.es/opendata/sh/inventario';

describe('AemetInventoryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the two-step fetch and decodes the latin-1 charset AEMET actually uses', async () => {
    // The live inventory is served as latin-1 (verified quirk): "TÍAS" contains
    // 0xCD, which is invalid UTF-8 — a naive Response.json() garbles the name.
    const latin1Body = Buffer.from(
      JSON.stringify([{ indicativo: 'C018J', nombre: 'TÍAS', provincia: 'LAS PALMAS' }]),
      'latin1',
    );
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === ENVELOPE_URL) {
        return new Response(JSON.stringify({ descripcion: 'exito', estado: 200, datos: DATA_URL }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(new Uint8Array(latin1Body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new AemetInventoryClient('https://aemet.example.test/opendata/api', 'test-api-key');
    const stations = await client.fetchAllStations();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ indicativo: 'C018J', nombre: 'TÍAS' });
  });
});
