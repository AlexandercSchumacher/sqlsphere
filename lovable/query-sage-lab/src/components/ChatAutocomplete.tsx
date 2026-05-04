import React, { useRef, useEffect } from 'react';
import { SchemaNode } from '@/components/SchemaTree';
import { useChatAutocomplete } from '@/hooks/useChatAutocomplete';
import { ChatSuggestion } from '@/utils/chatCompletionUtils';

interface ChatAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  schemaTree: SchemaNode[];
  dbType: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const typeBadgeColors: Record<string, string> = {
  table: 'bg-blue-500/20 text-blue-400',
  view: 'bg-purple-500/20 text-purple-400',
  column: 'bg-green-500/20 text-green-400',
  keyword: 'bg-orange-500/20 text-orange-400',
  function: 'bg-yellow-500/20 text-yellow-400',
};

export function ChatAutocomplete({
  value,
  onChange,
  onSend,
  schemaTree,
  dbType,
  disabled,
  placeholder,
  className,
}: ChatAutocompleteProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    suggestions,
    selectedIndex,
    isOpen,
    dropdownPosition,
    handleKeyDown,
    applySuggestion,
    close,
  } = useChatAutocomplete({
    schemaTree,
    dbType,
    inputValue: value,
    textareaRef: textareaRef as React.RefObject<HTMLTextAreaElement>,
    onInputChange: onChange,
  });

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || selectedIndex < 0 || !dropdownRef.current) return;
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Auto-resize
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={(e) => {
          // Let autocomplete handle it first
          const handled = handleKeyDown(e);
          if (!handled && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        rows={1}
        style={{ overflowY: 'auto' }}
      />

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-64 max-h-[200px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          style={{
            bottom: `${dropdownPosition.bottom}px`,
            left: `${Math.min(dropdownPosition.left, 0)}px`,
          }}
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.label}-${suggestion.type}`}
              className={`flex items-center justify-between gap-2 px-2 py-1 cursor-pointer text-[10px] ${
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // Keep textarea focus
                applySuggestion(suggestion);
              }}
              onMouseEnter={() => {
                // Don't update selectedIndex on hover to avoid conflicts
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
  );
}
