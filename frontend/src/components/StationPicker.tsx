import { useId, useRef, useState } from 'react';
import type { PickerStation } from '../api/contract';
import { useStations } from '../hooks/useStations';

interface StationPickerProps {
  readonly selected: PickerStation | null;
  readonly onSelect: (station: PickerStation | null) => void;
}

/**
 * Searchable station picker over GET /api/estaciones. Typing searches the
 * catalog server-side (id, name, or province); clicking a result selects it.
 */
export function StationPicker({ selected, onSelect }: StationPickerProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const { stations, loading } = useStations(search);
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // While a station is selected, show it; free the field on re-edit.
  const display = selected === null ? search : `${selected.id} · ${selected.name}`;

  const reset = () => {
    onSelect(null);
    setSearch('');
  };

  const handleBlur: React.FocusEventHandler = (event) => {
    if (wrapperRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    setOpen(false);
  };

  return (
    <div className="station-picker" ref={wrapperRef} onBlur={handleBlur}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label="Station"
        placeholder="Search by id, name, or province…"
        value={display}
        onChange={(event) => {
          reset();
          setSearch(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && (
        <ul id={listboxId} role="listbox" className="station-picker__results">
          {loading && <li className="station-picker__hint">Searching…</li>}
          {!loading && stations.length === 0 && (
            <li className="station-picker__hint">No station matches "{search}".</li>
          )}
          {stations.map((station) => (
            <li key={station.id} role="option" aria-selected={selected?.id === station.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(station);
                  setOpen(false);
                }}
              >
                <span className="station-picker__id">{station.id}</span>
                <span>{station.name}</span>
                {station.province !== null && <span className="station-picker__province">{station.province}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
