// chartHeuristics.ts
// Analyses query columns/results and infers whether + which chart type to render.

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export interface ChartConfig {
  type: ChartType;
  xKey: string;
  yKeys: string[];
  colorPalette: string[];
}

const VALID_CHART_TYPES: ChartType[] = ['bar', 'line', 'area', 'pie'];

const COLOR_PALETTE = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const DATE_TIME_PATTERNS = /date|time|year|month|week|day|quarter|period|created|updated|ts\b|timestamp/i;

function isNumeric(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !isNaN(Number(value));
}

function columnIsNumeric(col: string, results: Record<string, unknown>[]): boolean {
  const sample = results.slice(0, 20);
  const numericCount = sample.filter(row => isNumeric(row[col])).length;
  return numericCount >= Math.max(1, sample.length * 0.6);
}

function columnIsCategorical(col: string, results: Record<string, unknown>[]): boolean {
  return !columnIsNumeric(col, results);
}

/**
 * Infer a chart configuration from query results.
 *
 * @param columns   Array of column names returned by the query
 * @param results   Array of row objects
 * @param chartHint Optional hint from the LLM ("bar"|"line"|"pie"|"area"|null)
 * @returns ChartConfig if a chart should be rendered, null otherwise
 */
export function inferChartConfig(
  columns: string[],
  results: Record<string, unknown>[],
  chartHint?: string | null,
  preferredXKey?: string | null,
  preferredYKeys?: string[] | null
): ChartConfig | null {
  // Minimum data requirements
  if (!columns || columns.length < 2) return null;
  if (!results || results.length < 1) return null;

  const numericCols = columns.filter(c => columnIsNumeric(c, results));
  const categoricalCols = columns.filter(c => columnIsCategorical(c, results));

  if (numericCols.length === 0) return null;

  // Prefer explicit chart keys from widget config when they are present and valid.
  const explicitXKey = preferredXKey && columns.includes(preferredXKey) ? preferredXKey : null;
  const explicitYKeys = (preferredYKeys || []).filter(k => columns.includes(k) && k !== explicitXKey);
  const hintedType = VALID_CHART_TYPES.includes(chartHint as ChartType)
    ? (chartHint as ChartType)
    : null;

  if (explicitXKey && explicitYKeys.length > 0) {
    const fallbackType: ChartType = DATE_TIME_PATTERNS.test(explicitXKey) ? 'line' : 'bar';
    return {
      type: hintedType || fallbackType,
      xKey: explicitXKey,
      yKeys: explicitYKeys.slice(0, 3),
      colorPalette: COLOR_PALETTE,
    };
  }

  // Some result sets are fully numeric (e.g., age + metric). In that case,
  // use the first numeric column as x-axis and the remaining numeric columns as y-series.
  const fallbackNumericX = numericCols.length >= 2 ? numericCols[0] : null;
  const xCandidates = categoricalCols.length > 0
    ? categoricalCols
    : (fallbackNumericX ? [fallbackNumericX] : []);

  // ── Pie chart ──────────────────────────────────────────────────────────────
  // Requires exactly 1 categorical + 1 numeric, ≤ 12 rows, hint="pie"
  if (
    chartHint === 'pie' &&
    results.length <= 12 &&
    categoricalCols.length >= 1 &&
    numericCols.length >= 1
  ) {
    return {
      type: 'pie',
      xKey: categoricalCols[0],
      yKeys: [numericCols[0]],
      colorPalette: COLOR_PALETTE,
    };
  }

  // ── Line / Area chart ──────────────────────────────────────────────────────
  // Hint-driven or column-name heuristic for time-series
  const hasDateCol = columns.some(c => DATE_TIME_PATTERNS.test(c));
  if (chartHint === 'line' || chartHint === 'area' || hasDateCol) {
    const hintedDateX = columns.find(c => DATE_TIME_PATTERNS.test(c));
    const xKey = hintedDateX ?? xCandidates[0];
    if (!xKey) return null;

    const yKeys = numericCols.filter(c => c !== xKey);
    if (yKeys.length === 0) return null;

    const type: ChartType = chartHint === 'area' ? 'area' : 'line';
    return {
      type,
      xKey,
      yKeys: yKeys.slice(0, 3),
      colorPalette: COLOR_PALETTE,
    };
  }

  // ── Bar chart ──────────────────────────────────────────────────────────────
  // 1+ categorical, 1+ numeric, 2–500 rows
  if (
    xCandidates.length >= 1 &&
    numericCols.length >= 1 &&
    results.length >= 1 &&
    results.length <= 500
  ) {
    const xKey = xCandidates[0];
    const yKeys = numericCols.filter(c => c !== xKey);
    if (yKeys.length === 0) return null;

    return {
      type: 'bar',
      xKey,
      yKeys: yKeys.slice(0, 3),
      colorPalette: COLOR_PALETTE,
    };
  }

  return null;
}
