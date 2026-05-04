/**
 * Intelligent Context Selection for LLM
 * 
 * This utility helps reduce token usage by sending only relevant code parts
 * to the LLM, similar to how Cursor handles large codebases.
 */

export interface CodeContext {
  relevantCode: string;
  contextLines: number;
  totalLines: number;
  cursorLine?: number;
}

/**
 * Extract relevant code around cursor position (windowed context)
 * Similar to Cursor's approach: only send code around the area of interest
 */
export function getWindowedContext(
  code: string,
  cursorLine: number,
  windowSize: number = 50
): CodeContext {
  const lines = code.split('\n');
  const totalLines = lines.length;

  // If code is small enough, send everything
  if (totalLines <= windowSize * 2) {
    return {
      relevantCode: code,
      contextLines: totalLines,
      totalLines,
      cursorLine,
    };
  }

  // Calculate window bounds
  const startLine = Math.max(0, cursorLine - windowSize);
  const endLine = Math.min(totalLines, cursorLine + windowSize);

  // Extract relevant lines
  const relevantLines = lines.slice(startLine, endLine);
  const relevantCode = relevantLines.join('\n');

  return {
    relevantCode,
    contextLines: relevantLines.length,
    totalLines,
    cursorLine,
  };
}

/**
 * Extract only changed/modified sections
 * Useful when user is working on specific parts
 */
export function getChangedSections(
  oldCode: string,
  newCode: string,
  contextLines: number = 5
): CodeContext {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');
  
  // Find changed line ranges
  const changedRanges: Array<{ start: number; end: number }> = [];
  
  let i = 0;
  let j = 0;
  
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    } else {
      const start = Math.min(i, j);
      // Find where they sync again
      while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
        if (i < oldLines.length) i++;
        if (j < newLines.length) j++;
      }
      const end = Math.max(i, j);
      
      if (end > start) {
        changedRanges.push({ start, end });
      }
    }
  }

  // Extract changed sections with context
  const relevantLines: string[] = [];
  let lastEnd = 0;
  
  for (const range of changedRanges) {
    const contextStart = Math.max(0, range.start - contextLines);
    const contextEnd = Math.min(newLines.length, range.end + contextLines);
    
    // Add separator if there's a gap
    if (contextStart > lastEnd && lastEnd > 0) {
      relevantLines.push('// ... (unchanged code) ...');
    }
    
    relevantLines.push(...newLines.slice(contextStart, contextEnd));
    lastEnd = contextEnd;
  }

  return {
    relevantCode: relevantLines.join('\n'),
    contextLines: relevantLines.length,
    totalLines: newLines.length,
  };
}

/**
 * Smart context selection based on query intent
 * Analyzes the user's query to determine what code is relevant
 */
export function getSmartContext(
  code: string,
  userQuery: string,
  cursorLine?: number
): CodeContext {
  const lines = code.split('\n');
  const totalLines = lines.length;
  
  // Keywords that suggest specific code sections
  const queryLower = userQuery.toLowerCase();
  
  // If query mentions specific line numbers or functions
  const lineNumberMatch = userQuery.match(/line\s+(\d+)/i);
  if (lineNumberMatch && cursorLine === undefined) {
    const targetLine = parseInt(lineNumberMatch[1]) - 1;
    return getWindowedContext(code, targetLine, 30);
  }
  
  // If query mentions specific table/function names, find them
  const tableMatch = userQuery.match(/(?:table|from|join)\s+['"]?(\w+)['"]?/i);
  if (tableMatch) {
    const tableName = tableMatch[1];
    // Find lines containing this table name
    const relevantLineIndices: number[] = [];
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(tableName.toLowerCase())) {
        relevantLineIndices.push(idx);
      }
    });
    
    if (relevantLineIndices.length > 0) {
      // Get context around all relevant lines
      const minLine = Math.max(0, Math.min(...relevantLineIndices) - 20);
      const maxLine = Math.min(totalLines, Math.max(...relevantLineIndices) + 20);
      const relevantCode = lines.slice(minLine, maxLine).join('\n');
      
      return {
        relevantCode,
        contextLines: maxLine - minLine,
        totalLines,
        cursorLine: relevantLineIndices[0],
      };
    }
  }
  
  // Default: use cursor position or send everything if small
  if (cursorLine !== undefined) {
    return getWindowedContext(code, cursorLine, 50);
  }
  
  // If code is small, send everything
  if (totalLines <= 100) {
    return {
      relevantCode: code,
      contextLines: totalLines,
      totalLines,
    };
  }
  
  // Otherwise, send first 50 lines (likely the main query)
  return {
    relevantCode: lines.slice(0, 50).join('\n'),
    contextLines: 50,
    totalLines,
  };
}

/**
 * Format context for LLM prompt
 * Adds metadata about what was sent
 */
export function formatContextForLLM(context: CodeContext, includeMetadata: boolean = true): string {
  let result = context.relevantCode;
  
  if (includeMetadata && context.totalLines > context.contextLines) {
    result = `// Context: Showing lines around cursor (${context.contextLines} of ${context.totalLines} total lines)\n` +
             `// Cursor position: Line ${(context.cursorLine || 0) + 1}\n\n` +
             result;
  }
  
  return result;
}

