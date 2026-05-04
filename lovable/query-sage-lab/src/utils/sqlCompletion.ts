import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import {
  ChatSuggestion,
  buildSuggestionList,
  getContextualSuggestions,
  getCurrentWordStart,
} from './chatCompletionUtils';

export interface SchemaInfo {
  tables: Array<{ name: string; schema?: string; columns?: Array<{ name: string; dataType?: string }> }>;
  views: Array<{ name: string; schema?: string }>;
  procedures: Array<{ name: string; schema?: string }>;
  functions: Array<{ name: string; schema?: string }>;
}

export interface AICompletionOptions {
  enabled?: boolean;
  connectionId?: string;
  sessionId?: string;
  language?: string;
  supabaseClient?: any;
}

/**
 * Extract schema information from schema tree
 */
export function extractSchemaInfo(schemaTree: any[]): SchemaInfo {
  const info: SchemaInfo = {
    tables: [],
    views: [],
    procedures: [],
    functions: [],
  };

  const extractFromGroup = (group: any, type: 'table' | 'view' | 'procedure' | 'function') => {
    if (group.children) {
      group.children.forEach((node: any) => {
        if (node.type === type) {
          const item: any = {
            name: node.name,
            schema: node.schema,
          };

          if (node.children && node.type === 'table') {
            item.columns = node.children
              .filter((c: any) => c.type === 'column')
              .map((c: any) => ({
                name: c.name,
                dataType: c.dataType,
              }));
          }

          info[`${type}s` as keyof SchemaInfo].push(item);
        }
      });
    }
  };

  schemaTree.forEach((node) => {
    if (node.type === 'schema' && node.children) {
      node.children.forEach((group: any) => {
        if (group.type === 'group') {
          if (group.name === 'Tables') extractFromGroup(group, 'table');
          else if (group.name === 'Views') extractFromGroup(group, 'view');
          else if (group.name === 'Procedures') extractFromGroup(group, 'procedure');
          else if (group.name === 'Functions') extractFromGroup(group, 'function');
        }
      });
    }

    if (node.type === 'group') {
      if (node.name === 'Tables') extractFromGroup(node, 'table');
      else if (node.name === 'Views') extractFromGroup(node, 'view');
      else if (node.name === 'Procedures') extractFromGroup(node, 'procedure');
      else if (node.name === 'Functions') extractFromGroup(node, 'function');
    }
  });

  return info;
}

// Map ChatSuggestion types to CodeMirror completion types
const typeMap: Record<string, string> = {
  table: 'type',
  view: 'type',
  column: 'property',
  keyword: 'keyword',
  function: 'function',
};

/**
 * Create CodeMirror completion source using the same logic as the chat autocomplete
 */
export function createSQLCompletion(
  schemaInfo: SchemaInfo,
  aiOptions?: AICompletionOptions,
  dbType?: string,
) {
  const allSuggestions = buildSuggestionList(schemaInfo, dbType || 'postgresql');

  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const text = state.doc.toString();

    const filtered = getContextualSuggestions(text, pos, allSuggestions, schemaInfo);

    if (filtered.length === 0) return null;

    const from = getCurrentWordStart(text, pos);

    return {
      from,
      options: filtered.map((s: ChatSuggestion) => ({
        label: s.label,
        type: typeMap[s.type] || 'text',
        detail: s.detail || s.type,
      })),
    };
  };
}
