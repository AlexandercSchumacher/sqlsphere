import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL, MySQL, MSSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap, EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { Button } from '@/components/ui/button';
import { Play, Undo2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import DiffMatchPatch from 'diff-match-patch';
import { extractSchemaInfo, SchemaInfo, AICompletionOptions } from '@/utils/sqlCompletion';
import {
  ChatSuggestion,
  buildSuggestionList,
  getContextualSuggestions,
  getCurrentWordStart,
} from '@/utils/chatCompletionUtils';

interface SQLChange {
  id: string;
  oldValue: string;
  newValue: string;
  timestamp: Date;
  explanation?: string;
}

interface SQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: (sql: string) => void;
  dbType?: 'postgresql' | 'mysql' | 'sqlserver';
  readOnly?: boolean;
  pendingChange?: SQLChange | null;
  onAcceptChange?: () => void;
  onRejectChange?: () => void;
  onCursorPositionChange?: (line: number, column: number) => void;
  schemaTree?: any[];
  aiCompletionOptions?: AICompletionOptions;
}

const typeBadgeColors: Record<string, string> = {
  table: 'bg-blue-500/20 text-blue-400',
  view: 'bg-purple-500/20 text-purple-400',
  column: 'bg-green-500/20 text-green-400',
  keyword: 'bg-orange-500/20 text-orange-400',
  function: 'bg-yellow-500/20 text-yellow-400',
};

export const SQLEditor = ({
  value,
  onChange,
  onExecute,
  dbType = 'postgresql',
  readOnly = false,
  pendingChange,
  onAcceptChange,
  onRejectChange,
  onCursorPositionChange,
  schemaTree = [],
  aiCompletionOptions,
}: SQLEditorProps) => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });
  const [showDiff, setShowDiff] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ line: 0, column: 0 });
  const editorRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dmp = useRef(new DiffMatchPatch());

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Refs to mirror state for use in keymap handlers (avoid stale closures)
  const suggestionsRef = useRef<ChatSuggestion[]>([]);
  const selectedIndexRef = useRef(-1);
  suggestionsRef.current = suggestions;
  selectedIndexRef.current = selectedIndex;

  // Build suggestion list from schema
  const schemaInfo = useMemo<SchemaInfo>(() => {
    if (!schemaTree || schemaTree.length === 0) {
      return { tables: [], views: [], procedures: [], functions: [] };
    }
    return extractSchemaInfo(schemaTree);
  }, [schemaTree]);

  const allSuggestions = useMemo(
    () => buildSuggestionList(schemaInfo, dbType),
    [schemaInfo, dbType],
  );

  // Close autocomplete
  const closeAutocomplete = useCallback(() => {
    setSuggestions([]);
    setSelectedIndex(-1);
    setDropdownPos(null);
  }, []);

  // Apply a suggestion
  const applySuggestion = useCallback((suggestion: ChatSuggestion) => {
    const view = viewRef.current;
    if (!view) return;

    const state = view.state;
    const pos = state.selection.main.head;
    const text = state.doc.toString();
    const wordStart = getCurrentWordStart(text, pos);

    let insertText = suggestion.label;
    const after = text.slice(pos);
    if (!after.startsWith(' ') && !after.startsWith('.') && !after.startsWith(',')) {
      insertText += ' ';
    }

    view.dispatch({
      changes: { from: wordStart, to: pos, insert: insertText },
      selection: { anchor: wordStart + insertText.length },
    });

    closeAutocomplete();
    view.focus();
  }, [closeAutocomplete]);

  // Update suggestions based on current editor state
  const updateSuggestions = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;

    const state = view.state;
    const pos = state.selection.main.head;
    const text = state.doc.toString();

    const filtered = getContextualSuggestions(text, pos, allSuggestions, schemaInfo);

    if (filtered.length > 0) {
      // Get cursor pixel coordinates from CodeMirror
      const coords = view.coordsAtPos(pos);
      const containerRect = editorContainerRef.current?.getBoundingClientRect();

      if (coords && containerRect) {
        setDropdownPos({
          top: coords.bottom - containerRect.top + 2,
          left: coords.left - containerRect.left,
        });
      }

      setSuggestions(filtered);
      setSelectedIndex(0);
    } else {
      closeAutocomplete();
    }
  }, [allSuggestions, schemaInfo, closeAutocomplete]);

  // Listen for theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };

    handleThemeChange();

    window.addEventListener('themeChange', handleThemeChange);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          handleThemeChange();
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => {
      window.removeEventListener('themeChange', handleThemeChange);
      observer.disconnect();
    };
  }, []);

  // Show diff when there's a pending change
  useEffect(() => {
    if (pendingChange) {
      setShowDiff(true);
    }
  }, [pendingChange]);

  // Close on outside click
  useEffect(() => {
    if (suggestions.length === 0) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        closeAutocomplete();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [suggestions.length, closeAutocomplete]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !dropdownRef.current) return;
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Get SQL dialect based on database type
  const getSQLDialect = () => {
    switch (dbType) {
      case 'postgresql':
        return sql({ dialect: PostgreSQL });
      case 'mysql':
        return sql({ dialect: MySQL });
      case 'sqlserver':
        return sql({ dialect: MSSQL });
      default:
        return sql();
    }
  };

  // Refs for applySuggestion and closeAutocomplete so keymap can use them
  const applySuggestionRef = useRef(applySuggestion);
  const closeAutocompleteRef = useRef(closeAutocomplete);
  applySuggestionRef.current = applySuggestion;
  closeAutocompleteRef.current = closeAutocomplete;

  // Highest-priority keymap for autocomplete navigation
  // Uses refs to always access current state without recreating the extension
  const autocompleteKeyHandler = useMemo(() => {
    return Prec.highest(keymap.of([
      {
        key: 'ArrowDown',
        run: () => {
          const sug = suggestionsRef.current;
          if (sug.length === 0) return false;
          setSelectedIndex(i => (i + 1) % sug.length);
          return true;
        },
      },
      {
        key: 'ArrowUp',
        run: () => {
          const sug = suggestionsRef.current;
          if (sug.length === 0) return false;
          setSelectedIndex(i => (i - 1 + sug.length) % sug.length);
          return true;
        },
      },
      {
        key: 'Tab',
        run: () => {
          const sug = suggestionsRef.current;
          const idx = selectedIndexRef.current;
          if (sug.length === 0 || idx < 0 || idx >= sug.length) return false;
          applySuggestionRef.current(sug[idx]);
          return true;
        },
      },
      {
        key: 'Enter',
        run: () => {
          const sug = suggestionsRef.current;
          const idx = selectedIndexRef.current;
          if (sug.length === 0 || idx < 0 || idx >= sug.length) return false;
          applySuggestionRef.current(sug[idx]);
          return true;
        },
      },
      {
        key: 'Escape',
        run: () => {
          if (suggestionsRef.current.length === 0) return false;
          closeAutocompleteRef.current();
          return true;
        },
      },
    ]));
  }, []); // Empty deps - uses refs for everything

  // Calculate diff using diff-match-patch for accurate line-by-line diff
  const calculateDiff = () => {
    if (!pendingChange) return { diffs: [], oldLines: [], newLines: [] };

    const oldText = pendingChange.oldValue;
    const newText = pendingChange.newValue;

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const result: Array<{
      type: 'equal' | 'delete' | 'insert';
      oldLineIndex?: number;
      newLineIndex?: number;
      content: string;
    }> = [];

    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldIdx < oldLines.length ? oldLines[oldIdx] : null;
      const newLine = newIdx < newLines.length ? newLines[newIdx] : null;

      if (oldLine === newLine) {
        result.push({
          type: 'equal',
          oldLineIndex: oldIdx,
          newLineIndex: newIdx,
          content: oldLine!,
        });
        oldIdx++;
        newIdx++;
      } else {
        const oldLineInNew = newLine ? newLines.indexOf(oldLine || '', newIdx) : -1;
        const newLineInOld = oldLine ? oldLines.indexOf(newLine || '', oldIdx) : -1;

        if (oldLineInNew !== -1 && (newLineInOld === -1 || oldLineInNew < newLineInOld)) {
          while (newIdx < oldLineInNew) {
            result.push({
              type: 'insert',
              newLineIndex: newIdx,
              content: newLines[newIdx],
            });
            newIdx++;
          }
        } else if (newLineInOld !== -1) {
          while (oldIdx < newLineInOld) {
            result.push({
              type: 'delete',
              oldLineIndex: oldIdx,
              content: oldLines[oldIdx],
            });
            oldIdx++;
          }
        } else {
          if (oldLine) {
            result.push({
              type: 'delete',
              oldLineIndex: oldIdx,
              content: oldLine,
            });
            oldIdx++;
          }
          if (newLine) {
            result.push({
              type: 'insert',
              newLineIndex: newIdx,
              content: newLine,
            });
            newIdx++;
          }
        }
      }
    }

    return { diffs: result, oldLines, newLines };
  };

  const handleExecute = () => {
    const sqlToExecute = pendingChange ? pendingChange.newValue : value;
    onExecute(sqlToExecute);
  };

  const handleAccept = () => {
    if (pendingChange && onAcceptChange) {
      onChange(pendingChange.newValue);
      onAcceptChange();
      setShowDiff(false);
    }
  };

  const handleReject = () => {
    if (onRejectChange) {
      onRejectChange();
      setShowDiff(false);
    }
  };

  const diff = calculateDiff();

  const renderInlineDiff = () => {
    if (!pendingChange) return null;

    const { diffs, oldLines, newLines } = diff;

    let oldLineNum = 0;
    let newLineNum = 0;

    return (
      <div className="font-mono text-[11px] leading-tight h-full overflow-auto bg-background text-foreground">
        {diffs.map((diffItem, idx) => {
          if (diffItem.type === 'delete' && diffItem.oldLineIndex !== undefined) {
            oldLineNum = diffItem.oldLineIndex;
            return (
              <div
                key={`del-${idx}`}
                className="relative bg-red-500/10 border-l-2 border-red-500"
              >
                <div className="flex items-start">
                  <span className="text-muted-foreground select-none inline-block w-12 text-right px-2 py-0.5 bg-red-500/5">
                    {oldLineNum + 1}
                  </span>
                  <span className="text-red-400 px-2 py-0.5 flex-1">
                    {diffItem.content || ' '}
                  </span>
                </div>
              </div>
            );
          } else if (diffItem.type === 'insert' && diffItem.newLineIndex !== undefined) {
            newLineNum = diffItem.newLineIndex;
            return (
              <div
                key={`ins-${idx}`}
                className="relative bg-green-500/10 border-l-2 border-green-500"
              >
                <div className="flex items-start">
                  <span className="text-muted-foreground select-none inline-block w-12 text-right px-2 py-0.5 bg-green-500/5">
                    {newLineNum + 1}
                  </span>
                  <span className="text-green-400 px-2 py-0.5 flex-1">
                    {diffItem.content || ' '}
                  </span>
                </div>
              </div>
            );
          } else {
            const lineNum = diffItem.oldLineIndex !== undefined ? diffItem.oldLineIndex : (diffItem.newLineIndex || 0);
            return (
              <div
                key={`eq-${idx}`}
                className="relative"
              >
                <div className="flex items-start">
                  <span className="text-muted-foreground select-none inline-block w-12 text-right px-2 py-0.5">
                    {lineNum + 1}
                  </span>
                  <span className="text-foreground px-2 py-0.5 flex-1">
                    {diffItem.content || ' '}
                  </span>
                </div>
              </div>
            );
          }
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-background flex-shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleExecute}
            disabled={readOnly}
            className="gap-2 text-[10px] h-6"
          >
            <Play className="h-3 w-3" />
            Execute
          </Button>
          {pendingChange && (
            <>
              <Button
                size="sm"
                onClick={handleAccept}
                className="gap-1 text-[10px] h-6 bg-green-600 hover:bg-green-700"
              >
                <Check className="h-3 w-3" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleReject}
                className="gap-1 text-[10px] h-6"
              >
                <X className="h-3 w-3" />
                Reject
              </Button>
            </>
          )}
        </div>
        {pendingChange && (
          <div className="text-[10px] text-muted-foreground max-w-md truncate">
            {pendingChange.explanation}
          </div>
        )}
      </div>

      {/* Editor or Diff View */}
      <div ref={editorContainerRef} className="flex-1 min-h-0 overflow-hidden relative">
        {showDiff && pendingChange ? (
          renderInlineDiff()
        ) : (
          <CodeMirror
            ref={editorRef}
            value={value}
            height="100%"
            extensions={[getSQLDialect(), autocompleteKeyHandler]}
            onChange={(value) => !readOnly && onChange(value)}
            theme={isDarkMode ? oneDark : undefined}
            readOnly={readOnly}
            className="h-full [&_.cm-editor]:text-[11px] [&_.cm-line]:leading-tight"
            onCreateEditor={(view) => {
              viewRef.current = view;
            }}
            onUpdate={(viewUpdate) => {
              viewRef.current = viewUpdate.view;

              const state = viewUpdate.state;
              const selection = state.selection.main;
              const doc = state.doc;
              const line = doc.lineAt(selection.head);
              const lineNumber = line.number;
              const column = selection.head - line.from;

              setCursorPosition({ line: lineNumber, column });
              if (onCursorPositionChange) {
                onCursorPositionChange(lineNumber, column);
              }

              // Trigger autocomplete on document or selection changes
              if (viewUpdate.docChanged || viewUpdate.selectionSet) {
                updateSuggestions();
              }
            }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightSpecialChars: true,
              foldGutter: true,
              drawSelection: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: true,
              crosshairCursor: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              searchKeymap: true,
              foldKeymap: true,
              completionKeymap: false,
              lintKeymap: true,
            }}
          />
        )}

        {/* Custom autocomplete dropdown overlay */}
        {dropdownPos && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-64 max-h-[200px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
            style={{
              top: `${dropdownPos.top}px`,
              left: `${Math.min(dropdownPos.left, editorContainerRef.current ? editorContainerRef.current.clientWidth - 260 : 0)}px`,
            }}
          >
            {suggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.label}-${suggestion.type}-${index}`}
                className={`flex items-center justify-between gap-2 px-2 py-1 cursor-pointer text-[10px] ${
                  index === selectedIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(suggestion);
                }}
              >
                <span className="font-mono truncate text-popover-foreground">
                  {suggestion.label}
                </span>
                <span
                  className={`flex-shrink-0 px-1 py-0.5 rounded text-[8px] font-medium ${
                    typeBadgeColors[suggestion.type] || 'bg-muted text-muted-foreground'
                  }`}
                >
                  {suggestion.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
