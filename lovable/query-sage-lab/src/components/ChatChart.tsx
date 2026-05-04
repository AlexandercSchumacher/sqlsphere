// ChatChart.tsx
// Inline chart rendered as part of an AI assistant message.
// Uses recharts + shadcn chart.tsx primitives.

import { useState } from 'react';
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer, Tooltip,
} from 'recharts';
import { ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';
import { inferChartConfig } from '@/utils/chartHeuristics';

interface ChatChartProps {
  columns: string[];
  results: Record<string, unknown>[];
  chartHint?: string | null;
  xKey?: string | null;
  yKeys?: string[] | null;
}

const CHART_LABEL: Record<string, string> = {
  bar: 'Bar Chart',
  line: 'Line Chart',
  area: 'Area Chart',
  pie: 'Pie Chart',
};

// Resolved CSS custom property colours for recharts (recharts can't read CSS vars directly)
const COLORS = [
  '#6366f1', // indigo-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
];

export function ChatChart({ columns, results, chartHint, xKey, yKeys }: ChatChartProps) {
  const [expanded, setExpanded] = useState(false);

  const config = inferChartConfig(columns, results, chartHint, xKey, yKeys);
  if (!config) {
    return (
      <div className="mt-2 rounded-md border border-border/60 bg-background/50 px-3 py-2 text-[11px] text-muted-foreground">
        No chartable data for this widget.
      </div>
    );
  }

  const height = expanded ? 320 : 180;
  const label = CHART_LABEL[config.type] ?? 'Chart';

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderBarChart = () => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={results} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
        <XAxis
          dataKey={config.xKey}
          tick={{ fontSize: 9 }}
          tickFormatter={(v) => String(v).slice(0, 12)}
        />
        <YAxis tick={{ fontSize: 9 }} width={36} />
        <Tooltip contentStyle={{ fontSize: 10 }} />
        {config.yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 9 }} />}
        {config.yKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );

  const renderLineChart = () => (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={results} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
        <XAxis
          dataKey={config.xKey}
          tick={{ fontSize: 9 }}
          tickFormatter={(v) => String(v).slice(0, 12)}
        />
        <YAxis tick={{ fontSize: 9 }} width={36} />
        <Tooltip contentStyle={{ fontSize: 10 }} />
        {config.yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 9 }} />}
        {config.yKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            dot={results.length <= 50}
            strokeWidth={1.5}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );

  const renderAreaChart = () => (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={results} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
        <XAxis
          dataKey={config.xKey}
          tick={{ fontSize: 9 }}
          tickFormatter={(v) => String(v).slice(0, 12)}
        />
        <YAxis tick={{ fontSize: 9 }} width={36} />
        <Tooltip contentStyle={{ fontSize: 10 }} />
        {config.yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 9 }} />}
        {config.yKeys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            fill={COLORS[i % COLORS.length]}
            fillOpacity={0.15}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  const renderPieChart = () => (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={results}
          dataKey={config.yKeys[0]}
          nameKey={config.xKey}
          cx="50%"
          cy="50%"
          outerRadius={expanded ? 110 : 65}
          label={({ name, percent }) =>
            `${String(name).slice(0, 10)} ${(percent * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {results.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  );

  const renderChart = () => {
    switch (config.type) {
      case 'bar':  return renderBarChart();
      case 'line': return renderLineChart();
      case 'area': return renderAreaChart();
      case 'pie':  return renderPieChart();
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border/60 overflow-hidden bg-background/50">
      {/* Header bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b border-border/40">
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-medium">
          <BarChart2 className="h-3 w-3" />
          {label}
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
        >
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* Chart body */}
      <div className="p-2 transition-all duration-200">
        {renderChart()}
      </div>
    </div>
  );
}
