import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { extractSchemaInfo, SchemaInfo } from '@/utils/sqlCompletion';
import { SchemaNode } from '@/components/SchemaTree';
import {
  ChatSuggestion,
  buildSuggestionList,
  getContextualSuggestions,
  getCaretCoordinates,
  getCurrentWordStart,
} from '@/utils/chatCompletionUtils';

interface UseChatAutocompleteOptions {
  schemaTree: SchemaNode[];
  dbType: string;
  inputValue: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInputChange: (value: string) => void;
}

interface DropdownPosition {
  bottom: number;
  left: number;
}

export function useChatAutocomplete({
  schemaTree,
  dbType,
  inputValue,
  textareaRef,
  onInputChange,
}: UseChatAutocompleteOptions) {
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({ bottom: 0, left: 0 });

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

  const updateSuggestions = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const text = textarea.value;

    const filtered = getContextualSuggestions(text, cursorPos, allSuggestions, schemaInfo);

    if (filtered.length > 0) {
      const coords = getCaretCoordinates(textarea, cursorPos);
      const rect = textarea.getBoundingClientRect();
      const containerRect = textarea.parentElement?.getBoundingClientRect();
      if (containerRect) {
        setDropdownPosition({
          bottom: containerRect.bottom - rect.top - coords.top + 4,
          left: rect.left - containerRect.left + coords.left,
        });
      }
      setSuggestions(filtered);
      setSelectedIndex(0);
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setSuggestions([]);
      setSelectedIndex(-1);
    }
  }, [allSuggestions, schemaInfo, textareaRef]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIndex(-1);
  }, []);

  const applySuggestion = useCallback(
    (suggestion: ChatSuggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const text = textarea.value;
      const wordStart = getCurrentWordStart(text, cursorPos);

      // Check if we're in a dot context — if so, just insert column name
      const before = text.slice(0, cursorPos);
      const isDotContext = /\w+\.\w*$/.test(before);

      let insertText = suggestion.label;
      // Add trailing space unless it's a dot-column completion and there's already content after
      const after = text.slice(cursorPos);
      if (!after.startsWith(' ') && !after.startsWith('.') && !after.startsWith(',')) {
        insertText += ' ';
      }

      const newValue = text.slice(0, wordStart) + insertText + text.slice(cursorPos);
      onInputChange(newValue);

      // Set cursor position after inserted text
      const newPos = wordStart + insertText.length;
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
          textareaRef.current.focus();
        }
      });

      close();
    },
    [textareaRef, onInputChange, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => (i + 1) % suggestions.length);
          return true;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => (i - 1 + suggestions.length) % suggestions.length);
          return true;

        case 'Tab':
          if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
            e.preventDefault();
            applySuggestion(suggestions[selectedIndex]);
            return true;
          }
          return false;

        case 'Enter':
          if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
            e.preventDefault();
            applySuggestion(suggestions[selectedIndex]);
            return true;
          }
          // No item selected — let normal Enter behavior through
          close();
          return false;

        case 'Escape':
          e.preventDefault();
          close();
          return true;

        default:
          return false;
      }
    },
    [isOpen, selectedIndex, suggestions, applySuggestion, close],
  );

  // Update suggestions on input change
  useEffect(() => {
    // Small delay to let the textarea value update
    const timer = setTimeout(updateSuggestions, 50);
    return () => clearTimeout(timer);
  }, [inputValue, updateSuggestions]);

  return {
    suggestions,
    selectedIndex,
    isOpen,
    dropdownPosition,
    handleKeyDown,
    applySuggestion,
    close,
  };
}
