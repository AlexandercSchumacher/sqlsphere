import { SchemaInfo } from './sqlCompletion';

export interface ChatSuggestion {
  label: string;
  type: 'table' | 'column' | 'keyword' | 'function' | 'view';
  detail?: string;
}

const GENERIC_SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN',
  'FULL OUTER JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'IS NULL', 'IS NOT NULL', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'UNION', 'UNION ALL', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX',
  'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'CONSTRAINT', 'DEFAULT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'WITH', 'EXCEPT', 'INTERSECT',
];

const GENERIC_SQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'UPPER', 'LOWER', 'TRIM', 'LENGTH',
  'SUBSTRING', 'CONCAT', 'COALESCE', 'NULLIF', 'CAST', 'ROUND', 'FLOOR',
  'CEIL', 'ABS', 'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
];

export function getDbSpecificKeywords(dbType: string): { keywords: string[]; functions: string[] } {
  switch (dbType?.toLowerCase()) {
    case 'mysql':
      return {
        keywords: [
          'SHOW TABLES', 'SHOW DATABASES', 'DESCRIBE', 'EXPLAIN',
          'AUTO_INCREMENT', 'ENGINE', 'CHARSET', 'IF EXISTS', 'IF NOT EXISTS',
          'UNSIGNED', 'ZEROFILL', 'ON DUPLICATE KEY UPDATE',
          'STRAIGHT_JOIN', 'SQL_CALC_FOUND_ROWS', 'FOUND_ROWS',
        ],
        functions: [
          'IFNULL', 'GROUP_CONCAT', 'DATE_FORMAT', 'STR_TO_DATE',
          'DATEDIFF', 'TIMEDIFF', 'CURDATE', 'CURTIME',
          'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
          'LOCATE', 'REPLACE', 'REVERSE', 'FORMAT', 'CONV',
        ],
      };
    case 'sqlserver':
    case 'mssql':
      return {
        keywords: [
          'TOP', 'NOLOCK', 'WITH (NOLOCK)', 'IDENTITY', 'GO',
          'CROSS APPLY', 'OUTER APPLY', 'PIVOT', 'UNPIVOT',
          'MERGE', 'OUTPUT', 'INSERTED', 'DELETED',
          'TRY', 'CATCH', 'THROW', 'BEGIN TRY', 'END TRY',
          'BEGIN CATCH', 'END CATCH', 'DECLARE', 'SET',
        ],
        functions: [
          'GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'ISNULL',
          'CHARINDEX', 'PATINDEX', 'STRING_AGG', 'STUFF',
          'FORMAT', 'TRY_CAST', 'TRY_CONVERT', 'IIF',
          'DATEADD', 'DATEDIFF', 'DATENAME', 'DATEPART',
          'NEWID', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
        ],
      };
    case 'postgresql':
    case 'postgres':
      return {
        keywords: [
          'RETURNING', 'ILIKE', 'SERIAL', 'BIGSERIAL', 'LATERAL',
          'EXPLAIN ANALYZE', 'VACUUM', 'ANALYZE', 'REINDEX',
          'ON CONFLICT', 'DO NOTHING', 'DO UPDATE',
          'MATERIALIZED VIEW', 'REFRESH MATERIALIZED VIEW',
          'GENERATE_SERIES', 'TABLESAMPLE',
        ],
        functions: [
          'ARRAY_AGG', 'STRING_AGG', 'JSON_AGG', 'JSONB_AGG',
          'JSON_BUILD_OBJECT', 'JSONB_BUILD_OBJECT',
          'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'TO_NUMBER',
          'AGE', 'DATE_TRUNC', 'EXTRACT', 'INTERVAL',
          'REGEXP_MATCHES', 'REGEXP_REPLACE', 'SPLIT_PART',
          'UNNEST', 'ARRAY_LENGTH', 'GENERATE_SERIES',
        ],
      };
    default:
      return { keywords: [], functions: [] };
  }
}

export function buildSuggestionList(schemaInfo: SchemaInfo, dbType: string): ChatSuggestion[] {
  const suggestions: ChatSuggestion[] = [];

  // Schema objects
  for (const table of schemaInfo.tables) {
    suggestions.push({ label: table.name, type: 'table', detail: table.schema ? `Schema: ${table.schema}` : undefined });
  }

  for (const view of schemaInfo.views) {
    suggestions.push({ label: view.name, type: 'view', detail: view.schema ? `Schema: ${view.schema}` : undefined });
  }

  // Generic SQL keywords
  for (const kw of GENERIC_SQL_KEYWORDS) {
    suggestions.push({ label: kw, type: 'keyword' });
  }
  for (const fn of GENERIC_SQL_FUNCTIONS) {
    suggestions.push({ label: fn, type: 'function' });
  }

  // DB-specific
  const dbSpecific = getDbSpecificKeywords(dbType);
  for (const kw of dbSpecific.keywords) {
    suggestions.push({ label: kw, type: 'keyword', detail: dbType });
  }
  for (const fn of dbSpecific.functions) {
    suggestions.push({ label: fn, type: 'function', detail: dbType });
  }

  return suggestions;
}

export function getContextualSuggestions(
  text: string,
  cursorPos: number,
  allSuggestions: ChatSuggestion[],
  schemaInfo: SchemaInfo,
): ChatSuggestion[] {
  const before = text.slice(0, cursorPos);

  // After dot: suggest columns for the table before the dot
  const dotMatch = before.match(/(\w+)\.(\w*)$/);
  if (dotMatch) {
    const tableName = dotMatch[1];
    const prefix = dotMatch[2].toLowerCase();
    const table = schemaInfo.tables.find(
      t => t.name.toLowerCase() === tableName.toLowerCase()
        || (t.schema && `${t.schema}.${t.name}`.toLowerCase() === tableName.toLowerCase())
    );
    if (table?.columns) {
      return table.columns
        .filter(c => !prefix || c.name.toLowerCase().startsWith(prefix))
        .map(c => ({
          label: c.name,
          type: 'column' as const,
          detail: c.dataType || undefined,
        }));
    }
    return [];
  }

  // Get current word being typed
  const wordMatch = before.match(/(\w+)$/);
  if (!wordMatch || wordMatch[1].length < 2) return [];
  const prefix = wordMatch[1].toLowerCase();

  // Check context: word before the current word
  const beforeWord = before.slice(0, before.length - wordMatch[1].length).trimEnd();
  const upperBefore = beforeWord.toUpperCase();

  // After FROM/JOIN/INTO/UPDATE/TABLE: suggest tables
  if (/\b(FROM|JOIN|INTO|UPDATE|TABLE)\s*$/i.test(beforeWord)) {
    return allSuggestions
      .filter(s => (s.type === 'table' || s.type === 'view') && s.label.toLowerCase().startsWith(prefix))
      .slice(0, 8);
  }

  // After SELECT/WHERE/ORDER BY/GROUP BY: suggest columns first, then everything
  if (/\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY)\s*$/i.test(beforeWord) || /\b(AND|OR)\s*$/i.test(beforeWord)) {
    const columns: ChatSuggestion[] = [];
    for (const table of schemaInfo.tables) {
      if (table.columns) {
        for (const col of table.columns) {
          if (col.name.toLowerCase().startsWith(prefix)) {
            columns.push({
              label: col.name,
              type: 'column',
              detail: `${table.name}${col.dataType ? ` (${col.dataType})` : ''}`,
            });
          }
        }
      }
    }
    if (columns.length > 0) {
      // Dedupe by label
      const seen = new Set<string>();
      const unique = columns.filter(c => {
        if (seen.has(c.label)) return false;
        seen.add(c.label);
        return true;
      });
      return unique.slice(0, 8);
    }
  }

  // Default: prefix filter over all suggestions
  const startsWith = allSuggestions.filter(s => s.label.toLowerCase().startsWith(prefix));
  const contains = allSuggestions.filter(
    s => !s.label.toLowerCase().startsWith(prefix) && s.label.toLowerCase().includes(prefix)
  );
  return [...startsWith, ...contains].slice(0, 8);
}

/**
 * Calculate pixel position of the caret in a textarea using the mirror-div technique.
 */
export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const div = document.createElement('div');
  const style = div.style;
  const computed = getComputedStyle(textarea);

  // Copy all relevant styles
  const props = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize',
    'MozTabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
  ] as const;

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  for (const prop of props) {
    (style as any)[prop] = computed.getPropertyValue(
      prop.replace(/([A-Z])/g, '-$1').toLowerCase()
    );
  }

  div.textContent = textarea.value.substring(0, position);

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const coords = {
    top: span.offsetTop - textarea.scrollTop,
    left: span.offsetLeft - textarea.scrollLeft,
    height: parseInt(computed.lineHeight) || parseInt(computed.fontSize) * 1.2,
  };
  document.body.removeChild(div);

  return coords;
}

/**
 * Get the start position of the current word (for replacement when inserting a suggestion).
 */
export function getCurrentWordStart(text: string, cursorPos: number): number {
  const before = text.slice(0, cursorPos);
  // After dot: only replace the part after the dot
  const dotMatch = before.match(/(\w+)\.(\w*)$/);
  if (dotMatch) {
    return cursorPos - dotMatch[2].length;
  }
  const wordMatch = before.match(/(\w+)$/);
  if (wordMatch) {
    return cursorPos - wordMatch[1].length;
  }
  return cursorPos;
}
