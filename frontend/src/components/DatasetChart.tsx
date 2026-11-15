import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DatasetResponse } from '../api/contract';
import { TYPE_META, formatTick } from '../lib/display';

/**
 * Small multiples: one line chart per data type, sharing the x-axis and a
 * synced crosshair. Each chart has a single series — the title names it, so
 * no legend box — and every chart keeps its own unit (never a dual axis).
 */
export function DatasetChart({ dataset }: { readonly dataset: DatasetResponse }) {
  if (dataset.count === 0) {
    return null;
  }

  return (
    <div className="chart-grid">
      {dataset.types.map((type) => {
        const meta = TYPE_META[type];
        return (
          <section key={type} className="chart-multiple">
            <h3 className="chart-multiple__title">
              {meta.label}
              <span className="chart-multiple__unit">{meta.unit}</span>
            </h3>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={[...dataset.data]} syncId="windfarm-dataset" margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e7ecee" vertical={false} />
                <XAxis
                  dataKey="datetime"
                  tickFormatter={formatTick}
                  tick={{ fill: '#5b6f77', fontSize: 11 }}
                  tickMargin={8}
                  minTickGap={48}
                  stroke="#c9d3d6"
                />
                <YAxis
                  width={48}
                  tick={{ fill: '#5b6f77', fontSize: 11 }}
                  tickMargin={8}
                  stroke="#c9d3d6"
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  cursor={{ stroke: '#c9d3d6', strokeDasharray: '4 4' }}
                  labelFormatter={(label) => formatTick(String(label))}
                  formatter={(value) => [`${String(value)} ${meta.unit}`, meta.label]}
                />
                <Line
                  type="monotone"
                  dataKey={type}
                  stroke={meta.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        );
      })}
    </div>
  );
}
