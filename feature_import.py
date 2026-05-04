# feature_import.py
# Handles CSV/Excel/SQL file imports into databases

import logging
import pandas as pd
import io
import re
from typing import Dict, List, Tuple, Optional
import pyodbc
import mysql.connector
from models import DatabaseConnection

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB
CHUNK_SIZE = 5000  # Process 5000 rows at a time (increased for better performance with large imports)

def safe_extract_value(value):
    """Safely extract a value from database query results.
    Handles cases where pyodbc returns nested tuples (e.g., ('id',) instead of 'id').
    
    Args:
        value: The value to extract (can be a string, tuple, list, etc.)
    
    Returns:
        str: The extracted string value
    """
    # Handle nested tuples/lists (pyodbc sometimes returns ('id',) instead of 'id')
    while isinstance(value, (tuple, list)) and len(value) > 0:
        value = value[0]
    
    # Ensure we have a string
    result = str(value).strip()
    
    # Handle string representation of tuples like "('id',)" or "('id', )"
    # This can happen when pyodbc returns a tuple that gets stringified
    if result.startswith("('") and result.endswith("',)"):
        # Extract the value from "('id',)"
        result = result[2:-3].strip()
    elif result.startswith("('") and result.endswith("')"):
        # Extract the value from "('id')"
        result = result[2:-2].strip()
    elif result.startswith('("') and result.endswith('",)'):
        # Extract the value from '("id",)'
        result = result[2:-3].strip()
    elif result.startswith('("') and result.endswith('")'):
        # Extract the value from '("id")'
        result = result[2:-2].strip()
    
    # Remove quotes if present (after tuple extraction)
    if (result.startswith("'") and result.endswith("'")) or (result.startswith('"') and result.endswith('"')):
        result = result[1:-1]
    
    return result

def detect_file_type(filename: str) -> str:
    """Detect file type from extension."""
    filename_lower = filename.lower()
    if filename_lower.endswith('.csv'):
        return 'csv'
    elif filename_lower.endswith('.xlsx'):
        return 'xlsx'
    elif filename_lower.endswith('.xls'):
        return 'xls'
    elif filename_lower.endswith('.sql'):
        return 'sql'
    elif filename_lower.endswith('.json'):
        return 'json'
    else:
        raise ValueError(f"Unsupported file type: {filename}")

def detect_delimiter(file_content: bytes, encoding: str = 'utf-8', sample_lines: int = 10) -> str:
    """Detect CSV delimiter by analyzing first few lines."""
    try:
        # Try to decode first few lines
        text = file_content.decode(encoding, errors='ignore')
        lines = text.split('\n')[:sample_lines]
        
        # Count occurrences of common delimiters
        delimiters = [',', ';', '\t', '|']
        delimiter_counts = {delim: 0 for delim in delimiters}
        
        for line in lines:
            if not line.strip():
                continue
            for delim in delimiters:
                delimiter_counts[delim] += line.count(delim)
        
        # Return delimiter with highest count, default to comma
        detected = max(delimiter_counts.items(), key=lambda x: x[1])
        return detected[0] if detected[1] > 0 else ','
    except Exception:
        return ','  # Default fallback

def detect_encoding(file_content: bytes) -> str:
    """Detect file encoding by trying common encodings."""
    encodings = ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252', 'utf-16']
    
    for enc in encodings:
        try:
            file_content.decode(enc)
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    
    return 'utf-8'  # Default fallback

def detect_header_row(file_content: bytes, file_type: str, delimiter: str = ',', encoding: str = 'utf-8', sample_rows: int = 5) -> int:
    """
    Detect which row contains headers by analyzing data patterns.
    Returns row index (0-based) where headers are likely located.
    For SQL files, always returns 0 (columns are in INSERT statement).
    """
    try:
        if file_type == 'sql':
            # SQL files have column names in INSERT statement, not in a header row
            return 0
        
        if file_type == 'csv':
            text = file_content.decode(encoding, errors='ignore')
            lines = [line.strip() for line in text.split('\n')[:sample_rows] if line.strip()]
            
            if len(lines) < 2:
                return 0  # Default to first row
            
            # Analyze first few rows
            # Headers typically have more text-like values, fewer numbers
            scores = []
            for i, line in enumerate(lines[:3]):  # Check first 3 rows
                parts = line.split(delimiter)
                if len(parts) < 2:
                    continue
                
                # Score: more text = likely header, more numbers = likely data
                text_score = sum(1 for p in parts if not p.replace('.', '').replace('-', '').replace('+', '').strip().isdigit() and p.strip())
                num_score = sum(1 for p in parts if p.replace('.', '').replace('-', '').replace('+', '').strip().isdigit())
                
                # Header row typically has higher text-to-number ratio
                ratio = text_score / max(num_score, 1)
                scores.append((i, ratio, text_score))
            
            if scores:
                # Return row with highest text score (most likely header)
                best_row = max(scores, key=lambda x: x[2])
                return best_row[0]
            
            return 0  # Default to first row
        else:
            # For Excel files, try to detect header row by reading first few rows
            try:
                # Read first few rows without header to analyze
                df_sample = pd.read_excel(io.BytesIO(file_content), header=None, nrows=sample_rows)
                
                if len(df_sample) < 2:
                    return 0  # Default to first row
                
                # Analyze first few rows
                # Headers typically have more text-like values, fewer numbers
                scores = []
                for i in range(min(3, len(df_sample))):  # Check first 3 rows
                    row = df_sample.iloc[i]
                    text_score = 0
                    num_score = 0
                    
                    for val in row:
                        if pd.isna(val):
                            continue
                        val_str = str(val).strip()
                        # Check if it's numeric
                        try:
                            float(val_str.replace(',', ''))
                            num_score += 1
                        except ValueError:
                            text_score += 1
                    
                    # Header row typically has higher text-to-number ratio
                    ratio = text_score / max(num_score, 1) if num_score > 0 else text_score
                    scores.append((i, ratio, text_score))
                
                if scores:
                    # Return row with highest text score (most likely header)
                    best_row = max(scores, key=lambda x: x[2])
                    return best_row[0]
                
                return 0  # Default to first row
            except Exception:
                return 0  # Default fallback
    except Exception:
        return 0  # Default fallback

def parse_sql_file(file_content: bytes, encoding: str = 'utf-8', limit_rows: Optional[int] = None) -> pd.DataFrame:
    """
    Parse SQL file containing INSERT statements into pandas DataFrame.
    
    Supports formats:
    - INSERT INTO table VALUES (...)
    - INSERT INTO table (col1, col2) VALUES (...)
    - Multi-row INSERTs: INSERT INTO table VALUES (...), (...), (...)
    - Database functions: NOW(), CURRENT_TIMESTAMP, DEFAULT, etc.
    
    Args:
        file_content: SQL file content as bytes
        encoding: File encoding (default: utf-8)
        limit_rows: Maximum number of rows to read (None = no limit, used for preview)
    
    Returns:
        pandas DataFrame with extracted data
    """
    try:
        # Decode file content
        text = file_content.decode(encoding, errors='ignore')
        
        # Remove SQL comments using a character-level state machine.
        # Correctly handles: inline block comments (/* ... */), multi-line block
        # comments, -- line comments, and MySQL # comments.
        lines = text.split('\n')
        cleaned_lines = []
        in_block_comment = False
        for line in lines:
            result_line = ''
            i = 0
            while i < len(line):
                if in_block_comment:
                    if line[i:i+2] == '*/':
                        in_block_comment = False
                        i += 2
                    else:
                        i += 1
                else:
                    if line[i:i+2] == '/*':
                        in_block_comment = True
                        i += 2
                    elif line[i:i+2] == '--':
                        break  # rest of line is a comment
                    elif line[i] == '#':
                        break  # MySQL-style line comment
                    else:
                        result_line += line[i]
                        i += 1
            cleaned_lines.append(result_line)
        
        text = '\n'.join(cleaned_lines)
        
        # Normalize whitespace - replace multiple spaces/newlines with single space
        text = re.sub(r'\s+', ' ', text)
        
        # Find all INSERT statements - flexible pattern supporting multiple SQL dialects
        # Supports:
        # - PostgreSQL: "schema"."table" or schema.table
        # - MySQL: `schema`.`table` or schema.table
        # - SQL Server: [schema].[table] or schema.table
        # - SQLite: table (no schema)
        # Pattern: INSERT INTO table_name [columns] VALUES (values)
        # Allow for schema.table_name format with various quoting styles
        insert_pattern = re.compile(
            r'INSERT\s+(?:IGNORE\s+)?(?:OR\s+(?:REPLACE|ABORT|ROLLBACK|FAIL)\s+)?INTO\s+([\w\.`"\[\]]+(?:\.[\w\.`"\[\]]+)?)\s*(?:\(([^)]+)\))?\s*VALUES\s*',
            re.IGNORECASE | re.MULTILINE | re.DOTALL
        )
        
        all_rows = []
        column_names = None
        
        # Find all INSERT statements
        matches = list(insert_pattern.finditer(text))
        logger.debug("Found %d INSERT statement matches in SQL file", len(matches))

        if len(matches) == 0:
            # Try a more lenient pattern - maybe VALUES is on a different line
            lenient_pattern = re.compile(
                r'INSERT\s+INTO\s+([\w\.`"\[\]]+)\s*(?:\(([^)]+)\))?\s*VALUES',
                re.IGNORECASE | re.MULTILINE | re.DOTALL
            )
            lenient_matches = list(lenient_pattern.finditer(text))
            logger.debug("Lenient pattern found %d matches", len(lenient_matches))

            if len(lenient_matches) == 0:
                if 'INSERT' in text.upper() and 'INTO' in text.upper():
                    insert_pos = text.upper().find('INSERT')
                    sample = text[max(0, insert_pos-50):min(len(text), insert_pos+300)]
                    logger.debug("Found INSERT and INTO keywords, but pattern didn't match. Sample: %s", sample)
                raise ValueError("No INSERT statements found in SQL file. Make sure the file contains INSERT INTO ... VALUES statements.")
            else:
                matches = lenient_matches
        
        for match in matches:
            # Extract table name - handle various quoting styles
            table_full = match.group(1).strip()
            
            # Remove quotes/backticks/brackets from table name (support all SQL dialects)
            # PostgreSQL: "schema"."table" -> schema.table
            # MySQL: `schema`.`table` -> schema.table
            # SQL Server: [schema].[table] -> schema.table
            table_full = re.sub(r'[`"\[\]]', '', table_full)
            
            # Extract schema and table name
            if '.' in table_full:
                parts = table_full.split('.')
                schema_name = parts[0] if len(parts) > 1 else None
                table_name = parts[-1]
            else:
                schema_name = None
                table_name = table_full
            
            columns_str = match.group(2) if match.group(2) else None
            
            # Extract column names if provided - support all quoting styles
            if columns_str:
                # Parse column names: handle "col1", `col2`, [col3] -> col1, col2, col3
                # Split by comma, but be careful with quoted commas inside column names
                potential_columns = []
                current_col = ''
                in_quotes = False
                quote_char = None
                
                for char in columns_str:
                    if char in ('"', "'", '`', '[') and not in_quotes:
                        in_quotes = True
                        quote_char = char
                        continue
                    elif char == quote_char and in_quotes:
                        in_quotes = False
                        quote_char = None
                        continue
                    elif char == ']' and quote_char == '[':
                        in_quotes = False
                        quote_char = None
                        continue
                    elif char == ',' and not in_quotes:
                        # Column separator
                        col_name = current_col.strip().strip('"').strip("'").strip('`').strip('[').strip(']')
                        if col_name:
                            potential_columns.append(col_name)
                        current_col = ''
                    else:
                        current_col += char
                
                # Add last column
                if current_col.strip():
                    col_name = current_col.strip().strip('"').strip("'").strip('`').strip('[').strip(']')
                    if col_name:
                        potential_columns.append(col_name)
                # Only use if we haven't set column_names yet or they match
                if column_names is None:
                    column_names = potential_columns
                elif column_names != potential_columns:
                    # Different column structure - this is a warning but we'll use the first one
                    logger.warning("Different column structures found in SQL file. Using first: %s", column_names)
            
            # Find the VALUES part
            values_start = match.end()
            # Find the end of VALUES clause - look for semicolon or end of statement
            # VALUES can contain multiple tuples: VALUES (...), (...), (...);
            values_end = values_start
            in_string = False
            string_char = None
            paren_count = 0
            found_first_paren = False
            
            # Extract VALUES clause - continue until we find semicolon or end of statement
            i = values_start
            while i < len(text):
                char = text[i]
                
                # Handle string literals
                if char in ("'", '"') and (i == 0 or text[i-1] != '\\'):
                    if not in_string:
                        in_string = True
                        string_char = char
                    elif char == string_char:
                        in_string = False
                        string_char = None
                
                # Count parentheses (only when not in string)
                if not in_string:
                    if char == '(':
                        paren_count += 1
                        found_first_paren = True
                    elif char == ')':
                        paren_count -= 1
                    elif char == ';' and paren_count == 0 and found_first_paren:
                        # Found semicolon after all VALUES tuples
                        values_end = i
                        break
                    elif i > values_start + 1000 and paren_count == 0 and found_first_paren:
                        # Safety: if we've gone too far and parentheses are balanced, stop
                        # This handles cases where there's no semicolon
                        values_end = i
                        break
                
                i += 1
            
            # If we didn't find a semicolon, use the rest of the text
            if values_end == values_start:
                values_end = len(text)
            
            # Extract VALUES content
            values_text = text[values_start:values_end].strip()
            
            # Remove leading/trailing whitespace and semicolon if present
            values_text = values_text.rstrip(';').strip()
            
            # Handle multiple VALUES tuples: VALUES (...), (...), (...)
            # Split by '),(' pattern but be careful with nested parentheses and strings
            rows_text = []
            current_row = []
            current_value = ''
            paren_level = 0
            in_string = False
            string_char = None
            
            i = 0
            while i < len(values_text):
                char = values_text[i]
                
                # Handle escaped characters
                if i > 0 and values_text[i-1] == '\\':
                    current_value += char
                    i += 1
                    continue
                
                # Handle string literals
                if char in ("'", '"') and (i == 0 or values_text[i-1] != '\\'):
                    if not in_string:
                        in_string = True
                        string_char = char
                    elif char == string_char:
                        in_string = False
                        string_char = None
                    current_value += char
                elif not in_string:
                    if char == '(':
                        paren_level += 1
                        if paren_level == 1:
                            # Start of a new row tuple - reset current_value
                            current_value = ''
                        else:
                            # Nested parenthesis - keep in value
                            current_value += char
                    elif char == ')':
                        paren_level -= 1
                        if paren_level == 0:
                            # End of a row tuple
                            if current_value.strip():
                                current_row.append(current_value.strip())
                            if current_row:
                                rows_text.append(current_row)
                            current_row = []
                            current_value = ''
                            # Skip comma and whitespace after ')'
                            i += 1
                            while i < len(values_text) and values_text[i] in (',', ' ', '\n', '\r', '\t'):
                                i += 1
                            continue
                        else:
                            # Nested closing parenthesis
                            current_value += char
                    elif char == ',' and paren_level == 1:
                        # Value separator within a row tuple
                        current_row.append(current_value.strip())
                        current_value = ''
                    else:
                        current_value += char
                else:
                    current_value += char
                
                i += 1
            
            # Process last row if any (in case there's no trailing comma/whitespace)
            if current_value.strip() or current_row:
                if current_value.strip():
                    current_row.append(current_value.strip())
                if current_row:
                    rows_text.append(current_row)
            
            # Parse values (handle NULL, strings, numbers, database functions)
            for row_values in rows_text:
                parsed_row = []
                for val in row_values:
                    val = val.strip()
                    
                    # Handle NULL (various representations across databases)
                    # PostgreSQL/MySQL/SQL Server: NULL
                    # MySQL: \N (often used in exports)
                    if val.upper() == 'NULL' or val == '' or val.upper() == '\\N':
                        parsed_row.append(None)
                    # Handle database functions (cross-database support)
                    elif val.upper() in (
                        'NOW()', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP()',
                        'CURRENT_DATE', 'CURRENT_DATE()', 'CURRENT_TIME', 'CURRENT_TIME()',
                        'GETDATE()',  # SQL Server
                        'GETUTCDATE()',  # SQL Server
                        'SYSDATE', 'SYSTIMESTAMP',  # Oracle
                        'CURRENT_TIMESTAMP(6)', 'CURRENT_TIMESTAMP(3)',  # PostgreSQL with precision
                        'LOCALTIMESTAMP', 'LOCALTIME',  # SQL standard
                        'CURDATE()', 'CURTIME()'  # MySQL
                    ):
                        # These will be evaluated by the database, so we pass them as None
                        parsed_row.append(None)  # Will be handled by database default
                    elif val.upper() == 'DEFAULT':
                        # DEFAULT keyword - let database handle it
                        parsed_row.append(None)  # Will be handled by database
                    elif re.match(r'^[A-Z_][A-Z0-9_]*\([^)]*\)$', val.upper()):
                        # Generic function call like UUID(), RAND(), NEWID(), etc.
                        # Support various database functions with or without parameters
                        parsed_row.append(None)  # Will be handled by database
                    # Handle strings (quoted) - support single and double quotes
                    # Also handle escaped quotes: '' (PostgreSQL/MySQL), "" (MySQL), \' (MySQL)
                    elif (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
                        # Remove outer quotes
                        quote_char = val[0]
                        unquoted = val[1:-1]
                        # Handle escaped quotes (database-specific)
                        if quote_char == "'":
                            # PostgreSQL/MySQL: '' becomes '
                            unquoted = unquoted.replace("''", "'")
                            # MySQL: \' becomes '
                            unquoted = unquoted.replace("\\'", "'")
                        elif quote_char == '"':
                            # MySQL: "" becomes "
                            unquoted = unquoted.replace('""', '"')
                            # MySQL: \" becomes "
                            unquoted = unquoted.replace('\\"', '"')
                        parsed_row.append(unquoted)
                    # Handle numbers (integers and floats, including scientific notation)
                    # Support: 123, 123.45, -123, 1.23e+10, etc.
                    elif re.match(r'^-?\d+\.?\d*(?:[eE][+-]?\d+)?$', val):
                        try:
                            if '.' in val or 'e' in val.lower():
                                parsed_row.append(float(val))
                            else:
                                parsed_row.append(int(val))
                        except ValueError:
                            parsed_row.append(val)
                    # Handle booleans (various representations across databases)
                    # PostgreSQL: TRUE/FALSE, t/f
                    # MySQL: TRUE/FALSE, 1/0
                    # SQL Server: 1/0
                    elif val.upper() in ('TRUE', 'FALSE', '1', '0', 'YES', 'NO', 'Y', 'N', 'T', 'F'):
                        if val.upper() in ('TRUE', '1', 'YES', 'Y', 'T'):
                            parsed_row.append(True)
                        else:
                            parsed_row.append(False)
                    else:
                        # Fallback: treat as string (unquoted string literal)
                        parsed_row.append(val)
                
                if parsed_row:
                    all_rows.append(parsed_row)
        
        if not all_rows:
            raise ValueError("No INSERT statements found in SQL file")
        
        # Create DataFrame
        if column_names:
            # Ensure we have the right number of columns
            max_cols = max(len(row) for row in all_rows) if all_rows else 0
            if len(column_names) < max_cols:
                # Add default column names for extra columns
                column_names.extend([f'Column_{i+1}' for i in range(len(column_names), max_cols)])
            elif len(column_names) > max_cols:
                # Truncate column names if needed
                column_names = column_names[:max_cols]
            
            df = pd.DataFrame(all_rows, columns=column_names[:max_cols])
        else:
            # No column names specified, use default
            max_cols = max(len(row) for row in all_rows) if all_rows else 0
            df = pd.DataFrame(all_rows, columns=[f'Column_{i+1}' for i in range(max_cols)])
        
        # Limit rows if limit_rows is specified (for preview)
        if limit_rows is not None and len(df) > limit_rows:
            df = df.head(limit_rows)
        
        return df
    
    except Exception as e:
        raise ValueError(f"Error parsing SQL file: {str(e)}")

def parse_file(
    file_content: bytes, 
    file_type: str, 
    encoding: Optional[str] = None,
    delimiter: Optional[str] = None,
    header_row: Optional[int] = None,
    skip_rows: Optional[int] = None,
    limit_rows: Optional[int] = None
) -> pd.DataFrame:
    """
    Parse CSV, Excel, or SQL file into pandas DataFrame.
    
    Args:
        file_content: File content as bytes
        file_type: 'csv', 'xlsx', 'xls', or 'sql'
        encoding: File encoding (auto-detected if None)
        delimiter: CSV delimiter (auto-detected if None)
        header_row: Row index (0-based) containing headers (None = auto-detect, -1 = no headers)
        skip_rows: Number of rows to skip before header (for header_row > 0)
        limit_rows: Maximum number of rows to read (None = no limit, used for preview)
    """
    try:
        if file_type == 'csv':
            # Auto-detect encoding if not provided
            if encoding is None:
                encoding = detect_encoding(file_content)
            
            # Auto-detect delimiter if not provided
            if delimiter is None:
                delimiter = detect_delimiter(file_content, encoding)
            
            # Auto-detect header row if not provided
            if header_row is None:
                header_row = detect_header_row(file_content, file_type, delimiter, encoding)
            
            # Determine pandas read_csv parameters
            pandas_header = header_row if header_row >= 0 else None
            pandas_skiprows = None
            
            # If header is not in first row, we need to skip rows
            if header_row > 0:
                pandas_skiprows = list(range(header_row))
                pandas_header = 0  # After skipping, header is at row 0
            
            # Try different encodings as fallback
            encodings_to_try = [encoding, 'utf-8', 'latin-1', 'iso-8859-1']
            last_error = None
            
            for enc in encodings_to_try:
                try:
                    read_params = {
                        'filepath_or_buffer': io.BytesIO(file_content),
                        'encoding': enc,
                        'delimiter': delimiter
                    }
                    
                    # Only limit rows if limit_rows is specified (for preview)
                    if limit_rows is not None:
                        read_params['nrows'] = limit_rows
                    
                    if pandas_header is not None:
                        read_params['header'] = pandas_header
                    else:
                        read_params['header'] = None
                        read_params['names'] = None  # Will generate default column names
                    
                    if pandas_skiprows:
                        read_params['skiprows'] = pandas_skiprows
                    
                    df = pd.read_csv(**read_params)
                    
                    # If no headers, generate default column names
                    if pandas_header is None or pandas_header == -1:
                        df.columns = [f'Column_{i+1}' for i in range(len(df.columns))]
                    
                    return df
                except UnicodeDecodeError:
                    last_error = UnicodeDecodeError
                    continue
                except Exception as e:
                    last_error = e
                    continue
            
            raise ValueError(f"Could not decode CSV file with common encodings: {str(last_error)}")
        
        elif file_type in ['xlsx', 'xls']:
            # For Excel, handle header_row
            read_params = {
                'io': io.BytesIO(file_content)
            }
            
            # Only limit rows if limit_rows is specified (for preview)
            if limit_rows is not None:
                read_params['nrows'] = limit_rows
            
            if header_row is not None:
                if header_row >= 0:
                    read_params['header'] = header_row
                else:
                    read_params['header'] = None
            
            if skip_rows:
                read_params['skiprows'] = skip_rows
            
            df = pd.read_excel(**read_params)
            
            # If no headers, generate default column names
            if header_row is not None and header_row == -1:
                df.columns = [f'Column_{i+1}' for i in range(len(df.columns))]
            
            return df
        
        elif file_type == 'sql':
            # Parse SQL file (INSERT statements)
            sql_encoding = encoding if encoding else 'utf-8'
            return parse_sql_file(file_content, encoding=sql_encoding, limit_rows=limit_rows)
            
        elif file_type == 'json':
            # Parse JSON file
            # Determine orientation - try 'records' first (list of dicts)
            try:
                df = pd.read_json(io.BytesIO(file_content), orient='records')
            except ValueError:
                # Try split orientation if records fails
                try:
                    df = pd.read_json(io.BytesIO(file_content), orient='split')
                except ValueError:
                    # Try index orientation
                    try:
                        df = pd.read_json(io.BytesIO(file_content), orient='index')
                    except ValueError:
                         # Try values orientation
                        try:
                            df = pd.read_json(io.BytesIO(file_content), orient='values')
                        except ValueError:
                            # Try default
                            df = pd.read_json(io.BytesIO(file_content))
            
            # Limit rows for preview
            if limit_rows is not None and len(df) > limit_rows:
                df = df.head(limit_rows)
                
            return df
        
        else:
            raise ValueError(f"Unsupported file type: {file_type}")
    
    except Exception as e:
        raise ValueError(f"Error parsing file: {str(e)}")

def get_table_columns(conn, engine: str, table_name: str, schema: Optional[str] = None) -> List[Dict]:
    """Get column information for a table."""
    cursor = conn.cursor()
    
    if engine == "postgresql":
        if schema:
            query = """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            """
            try:
                cursor.execute(query, (schema, table_name))
            except Exception as e:
                logger.error("get_table_columns (PostgreSQL with schema=%s, table=%s): %s", schema, table_name, e)
                raise
        else:
            # If no schema provided, search all schemas (excluding system schemas)
            query = """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_name = ?
            ORDER BY ordinal_position
            """
            try:
                cursor.execute(query, (table_name,))
            except Exception as e:
                logger.error("get_table_columns (PostgreSQL, table=%s): %s", table_name, e)
                raise
    
    elif engine == "mysql":
        # Check if it's mysql.connector (uses %s) or pyodbc (uses ?)
        use_mysql_connector = False
        try:
            import mysql.connector
            if isinstance(conn, mysql.connector.connection.MySQLConnection):
                use_mysql_connector = True
        except:
            pass
        
        if use_mysql_connector:
            query = """
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
            """
            cursor.execute(query, (table_name,))
        else:
            # pyodbc uses ? placeholders
            query = """
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
            """
            cursor.execute(query, (table_name,))
    
    elif engine == "sqlserver":
        if schema:
            query = """
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
            """
            cursor.execute(query, (schema, table_name))
        else:
            query = """
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
            """
            cursor.execute(query, (table_name,))
    
    else:
        raise ValueError(f"Unsupported engine: {engine}")
    
    columns = []
    for row in cursor.fetchall():
        columns.append({
            'name': safe_extract_value(row[0]),
            'type': safe_extract_value(row[1]),
            'nullable': safe_extract_value(row[2]) == 'YES',
            'default': safe_extract_value(row[3]) if len(row) > 3 else None  # column_default
        })
    
    return columns

def create_simple_mapping(df_columns: List[str], db_columns: List[Dict]) -> Dict[str, str]:
    """Create simple mapping: first CSV column -> first DB column, etc."""
    mapping = {}
    min_len = min(len(df_columns), len(db_columns))
    
    for i in range(min_len):
        mapping[df_columns[i]] = db_columns[i]['name']
    
    return mapping

def validate_data_types(df: pd.DataFrame, mapping: Dict[str, str], db_columns: List[Dict]) -> List[str]:
    """Validate that data types match. Returns list of warnings."""
    warnings = []
    
    # Create lookup for DB column types
    db_col_lookup = {col['name']: col['type'] for col in db_columns}
    
    for csv_col, db_col in mapping.items():
        if db_col not in db_col_lookup:
            continue
        
        db_type = db_col_lookup[db_col].upper()
        csv_dtype = str(df[csv_col].dtype)
        
        # Basic type checking
        if 'INT' in db_type and 'int' not in csv_dtype.lower():
            warnings.append(f"Column '{db_col}' expects integer, but CSV has {csv_dtype}")
        elif 'DECIMAL' in db_type or 'NUMERIC' in db_type or 'FLOAT' in db_type or 'DOUBLE' in db_type:
            if 'float' not in csv_dtype.lower() and 'int' not in csv_dtype.lower():
                warnings.append(f"Column '{db_col}' expects numeric, but CSV has {csv_dtype}")
        elif 'DATE' in db_type or 'TIME' in db_type:
            if 'datetime' not in csv_dtype.lower() and 'date' not in csv_dtype.lower():
                warnings.append(f"Column '{db_col}' expects date/time, but CSV has {csv_dtype}")
    
    return warnings

def validate_required_columns(mapping: Dict[str, str], db_columns: List[Dict]) -> Tuple[bool, List[str]]:
    """Validate that all NOT NULL columns (without defaults) are mapped. Returns (is_valid, missing_columns)."""
    mapped_db_columns = set(mapping.values())
    missing_columns = []
    
    for col in db_columns:
        # Check if column is NOT NULL and has no default value
        if not col.get('nullable', True) and not col.get('default'):
            if col['name'] not in mapped_db_columns:
                missing_columns.append(col['name'])
    
    return len(missing_columns) == 0, missing_columns

def get_primary_key_columns(conn, engine: str, table_name: str, schema: Optional[str] = None) -> List[str]:
    """Get primary key column names for a table."""
    try:
        cursor = conn.cursor()
        if engine == "postgresql":
            # PostgreSQL: Get primary key columns using information_schema (more compatible with pyodbc)
            if schema:
                # Try using information_schema first (more compatible)
                query = """
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = ?
                  AND tc.table_name = ?
                ORDER BY kcu.ordinal_position;
                """
                cursor.execute(query, (schema, table_name))
                rows = cursor.fetchall()
            else:
                # If no schema provided, search all schemas (excluding system schemas)
                # This allows the function to work with any schema name, not just 'public'
                query = """
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
                  AND tc.table_name = ?
                ORDER BY kcu.ordinal_position;
                """
                cursor.execute(query, (table_name,))
                rows = cursor.fetchall()
        elif engine == "mysql":
            query = """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND CONSTRAINT_NAME = 'PRIMARY';
            """
            cursor.execute(query, (table_name,))
            rows = cursor.fetchall()
        elif engine == "sqlserver":
            if schema:
                query = """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = ?
                AND TABLE_NAME = ?
                AND CONSTRAINT_NAME LIKE 'PK_%';
                """
                cursor.execute(query, (schema, table_name))
            else:
                query = """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_NAME = ?
                AND CONSTRAINT_NAME LIKE 'PK_%';
                """
                cursor.execute(query, (table_name,))
            rows = cursor.fetchall()
        else:
            return []
        cursor.close()
        
        # Extract column names from results
        pk_columns = []
        for row in rows:
            if isinstance(row, (list, tuple)) and len(row) > 0:
                col_name = safe_extract_value(row[0])
                pk_columns.append(col_name)
            else:
                col_name = safe_extract_value(row)
                pk_columns.append(col_name)
        
        return pk_columns
    except Exception as e:
        logger.warning("Could not get primary key columns for %s: %s", table_name, e)
        return []

def generate_insert_sql(engine: str, table_name: str, schema: Optional[str], columns: List[str], duplicate_handling: str = 'error', primary_key_columns: Optional[List[str]] = None) -> Tuple[str, str]:
    """Generate INSERT SQL statement. Returns (sql, placeholder_type).
    
    Args:
        engine: Database engine type
        table_name: Name of the table
        schema: Optional schema name
        columns: List of column names
        duplicate_handling: How to handle duplicates: 'error' (fail), 'skip' (ignore), or 'update' (update existing)
    """
    if schema:
        if engine == "mysql":
            full_table = f"`{schema}`.`{table_name}`"
        elif engine == "postgresql":
            full_table = f'"{schema}"."{table_name}"'
        elif engine == "sqlserver":
            full_table = f"[{schema}].[{table_name}]"
        else:
            full_table = f"{schema}.{table_name}"
    else:
        if engine == "mysql":
            full_table = f"`{table_name}`"
        elif engine == "postgresql":
            full_table = f'"{table_name}"'
        elif engine == "sqlserver":
            full_table = f"[{table_name}]"
        else:
            full_table = table_name
    
    # Quote column names based on engine
    if engine == "mysql":
        quoted_columns = [f"`{col}`" for col in columns]
        placeholder = "%s"  # MySQL uses %s
    elif engine == "postgresql":
        quoted_columns = [f'"{col}"' for col in columns]
        placeholder = "?"  # PostgreSQL with pyodbc uses ?
    elif engine == "sqlserver":
        quoted_columns = [f"[{col}]" for col in columns]
        placeholder = "?"  # SQL Server uses ?
    else:
        quoted_columns = columns
        placeholder = "?"
    
    placeholders = ", ".join([placeholder for _ in columns])
    columns_str = ", ".join(quoted_columns)
    
    # Build SQL with duplicate handling if requested
    if duplicate_handling in ['skip', 'update']:
        if engine == "postgresql":
            # PostgreSQL: Use ON CONFLICT
            # Try to use specific primary key columns if available
            if primary_key_columns:
                # Filter to only include PK columns that are actually in the INSERT columns
                pk_in_insert = [col for col in primary_key_columns if col in columns]
                if pk_in_insert:
                    # Quote PK column names
                    quoted_pk = [f'"{col}"' for col in pk_in_insert]
                    pk_str = ", ".join(quoted_pk)
                    
                    if duplicate_handling == 'skip':
                        # Skip duplicates
                        sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT ({pk_str}) DO NOTHING"
                    else:  # update
                        # Update existing rows - update all columns except primary key
                        update_columns = [col for col in columns if col not in pk_in_insert]
                        if update_columns:
                            quoted_update_cols = [f'"{col}"' for col in update_columns]
                            update_set = ", ".join([f'{col} = EXCLUDED.{col}' for col in quoted_update_cols])
                            sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT ({pk_str}) DO UPDATE SET {update_set}"
                        else:
                            # No columns to update (only PK in INSERT), just skip
                            sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT ({pk_str}) DO NOTHING"
                else:
                    # No PK columns in INSERT, use generic ON CONFLICT
                    if duplicate_handling == 'skip':
                        sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                    else:
                        # For update without PK info, we can't do much - fall back to skip
                        sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
            else:
                # No PK info available, use generic ON CONFLICT
                if duplicate_handling == 'skip':
                    sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
                else:
                    # For update without PK info, we can't do much - fall back to skip
                    sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
        elif engine == "mysql":
            if duplicate_handling == 'skip':
                # MySQL: Use INSERT IGNORE
                sql = f"INSERT IGNORE INTO {full_table} ({columns_str}) VALUES ({placeholders})"
            else:  # update
                # MySQL: Use INSERT ... ON DUPLICATE KEY UPDATE
                # Get columns to update (all except primary key)
                update_columns = [col for col in columns if col not in (primary_key_columns or [])]
                if update_columns:
                    quoted_update_cols = [f"`{col}`" for col in update_columns]
                    update_set = ", ".join([f'{col} = VALUES({col})' for col in quoted_update_cols])
                    sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders}) ON DUPLICATE KEY UPDATE {update_set}"
                else:
                    # No columns to update, use INSERT IGNORE
                    sql = f"INSERT IGNORE INTO {full_table} ({columns_str}) VALUES ({placeholders})"
        elif engine == "sqlserver":
            # SQL Server: MERGE for skip/update when primary key columns are known.
            # Falls back to regular INSERT when no PK info is available.
            pk_in_insert = [col for col in (primary_key_columns or []) if col in columns]
            if pk_in_insert:
                quoted_pk = [f"[{col}]" for col in pk_in_insert]
                on_conditions = " AND ".join(
                    [f"target.{qcol} = source.{qcol}" for qcol in quoted_pk]
                )
                source_insert_vals = ", ".join([f"source.[{col}]" for col in columns])
                if duplicate_handling == 'skip':
                    sql = (
                        f"MERGE INTO {full_table} AS target "
                        f"USING (VALUES ({placeholders})) AS source ({columns_str}) "
                        f"ON {on_conditions} "
                        f"WHEN NOT MATCHED THEN "
                        f"INSERT ({columns_str}) VALUES ({source_insert_vals});"
                    )
                else:  # update
                    update_columns = [col for col in columns if col not in pk_in_insert]
                    if update_columns:
                        update_set = ", ".join(
                            [f"target.[{col}] = source.[{col}]" for col in update_columns]
                        )
                        sql = (
                            f"MERGE INTO {full_table} AS target "
                            f"USING (VALUES ({placeholders})) AS source ({columns_str}) "
                            f"ON {on_conditions} "
                            f"WHEN MATCHED THEN UPDATE SET {update_set} "
                            f"WHEN NOT MATCHED THEN "
                            f"INSERT ({columns_str}) VALUES ({source_insert_vals});"
                        )
                    else:
                        # Only PK columns in INSERT – just skip duplicates
                        sql = (
                            f"MERGE INTO {full_table} AS target "
                            f"USING (VALUES ({placeholders})) AS source ({columns_str}) "
                            f"ON {on_conditions} "
                            f"WHEN NOT MATCHED THEN "
                            f"INSERT ({columns_str}) VALUES ({source_insert_vals});"
                        )
            else:
                # No PK info – fall back to regular INSERT
                logger.warning(
                    "SQL Server duplicate handling '%s' requested but no primary key columns "
                    "found for table %s; falling back to regular INSERT.",
                    duplicate_handling, table_name
                )
                sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders})"
        else:
            sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders})"
    else:
        # duplicate_handling == 'error' (default)
        sql = f"INSERT INTO {full_table} ({columns_str}) VALUES ({placeholders})"
    
    return sql, placeholder

def get_default_value_for_type(col_type: str) -> any:
    """Get a default value for a column type."""
    col_type_upper = col_type.upper()
    if 'INT' in col_type_upper:
        return 0
    elif 'FLOAT' in col_type_upper or 'REAL' in col_type_upper or 'NUMERIC' in col_type_upper or 'DECIMAL' in col_type_upper:
        return 0.0
    elif 'BOOL' in col_type_upper:
        return False
    elif 'DATE' in col_type_upper or 'TIME' in col_type_upper:
        return None  # Will use database default or current timestamp
    else:
        return ''  # Empty string for TEXT/VARCHAR

def import_data(
    conn,
    engine: str,
    table_name: str,
    schema: Optional[str],
    df: pd.DataFrame,
    mapping: Dict[str, str],
    db_columns: Optional[List[Dict]] = None,
    chunk_size: int = CHUNK_SIZE,
    duplicate_handling: str = 'error'
) -> Dict:
    """Import DataFrame into database table."""
    # Get mapped columns (DB column names) - ONLY the ones that are actually mapped
    mapped_db_columns = list(mapping.values())
    
    # Track which columns we're adding with default values (only for NOT NULL without default)
    default_value_columns = {}  # {column_name: default_value}
    
    # If db_columns is provided, check for NOT NULL columns without defaults that aren't mapped
    # These MUST have a value, so we'll add them with default values
    # Columns that are nullable OR have defaults can be safely omitted
    if db_columns:
        for col in db_columns:
            col_name = col['name']
            # Only add if: NOT NULL AND no default AND not already mapped
            # If nullable OR has default, we can safely omit it from INSERT
            if col_name not in mapped_db_columns:
                if not col.get('nullable', True) and not col.get('default'):
                    # This column MUST have a value - add it with default
                    default_val = get_default_value_for_type(col['type'])
                    default_value_columns[col_name] = default_val
                    mapped_db_columns.append(col_name)
                # If column is nullable OR has default, we simply don't include it in INSERT
                # The database will handle it (NULL or use default)
    
    # Get primary key columns if duplicate handling is enabled
    primary_key_columns = []
    logger.debug("duplicate_handling=%s (type=%s)", duplicate_handling, type(duplicate_handling).__name__)
    if duplicate_handling in ['skip', 'update']:
        try:
            logger.debug("Fetching primary key columns for %s.%s", schema, table_name)
            primary_key_columns = get_primary_key_columns(conn, engine, table_name, schema)
            if primary_key_columns:
                logger.debug("Primary key columns: %s", primary_key_columns)
            else:
                logger.warning("No primary key columns found for table %s – duplicate handling may be limited", table_name)
        except Exception as e:
            import traceback
            logger.error("Could not get primary key columns for %s: %s\n%s", table_name, e, traceback.format_exc())
            primary_key_columns = []

    # Generate SQL - only for columns we're actually inserting
    sql, _ = generate_insert_sql(engine, table_name, schema, mapped_db_columns, duplicate_handling=duplicate_handling, primary_key_columns=primary_key_columns)
    logger.debug("Generated SQL: %s", sql)
    
    # Handle MySQL connector differently
    if engine == "mysql" and hasattr(conn, 'cursor'):
        # Check if it's mysql.connector (not pyodbc)
        try:
            import mysql.connector
            if isinstance(conn, mysql.connector.connection.MySQLConnection):
                cursor = conn.cursor()
                use_mysql_connector = True
            else:
                cursor = conn.cursor()
                use_mysql_connector = False
        except:
            cursor = conn.cursor()
            use_mysql_connector = False
    else:
        cursor = conn.cursor()
        use_mysql_connector = False
    
    rows_imported = 0
    rows_failed = 0
    errors = []
    
    try:
        # Process in chunks
        for start_idx in range(0, len(df), chunk_size):
            chunk = df.iloc[start_idx:start_idx + chunk_size]
            
            for idx, row in chunk.iterrows():
                try:
                    # Map CSV columns to DB columns
                    values = []
                    # First, add values from mapped CSV columns (in the order of mapped_db_columns)
                    for db_col in mapped_db_columns:
                        # Check if this column is in the mapping (from CSV)
                        csv_col = None
                        for csv_key, db_val in mapping.items():
                            if db_val == db_col:
                                csv_col = csv_key
                                break
                        
                        if csv_col is not None:
                            # This column is mapped from CSV
                            value = row[csv_col]
                            
                            # Handle NaN/None
                            if pd.isna(value):
                                values.append(None)
                            else:
                                # Convert pandas types to Python types
                                if hasattr(value, 'item'):
                                    value = value.item()
                                
                                # Validate and convert based on database column type
                                if db_columns:
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info:
                                        db_type = db_col_info.get('type', '').upper()
                                        
                                        # Type validation and conversion
                                        if 'INT' in db_type:
                                            # Ensure it's an integer
                                            try:
                                                if isinstance(value, str):
                                                    # Try to convert string to int
                                                    # First check if it's numeric
                                                    if not value.strip() or value.strip() == '':
                                                        values.append(None)
                                                        continue
                                                    # Try to convert via float first to handle "1.0"
                                                    value = int(float(value))
                                                elif isinstance(value, float):
                                                    if pd.isna(value):
                                                        values.append(None)
                                                        continue
                                                    if value.is_integer():
                                                        value = int(value)
                                                    else:
                                                        # Non-integer float - this is an error
                                                        raise ValueError(f"Cannot convert {value} to integer")
                                                elif not isinstance(value, int):
                                                    value = int(value)
                                            except (ValueError, TypeError) as e:
                                                # Conversion failed - this row will fail
                                                error_msg = f"Column '{db_col}' (INTEGER) cannot accept value '{value}': {str(e)}"
                                                raise ValueError(error_msg)
                                        elif 'FLOAT' in db_type or 'REAL' in db_type or 'NUMERIC' in db_type or 'DECIMAL' in db_type:
                                            # Ensure it's a number
                                            try:
                                                if isinstance(value, str):
                                                    if not value.strip() or value.strip() == '':
                                                        values.append(None)
                                                        continue
                                                    value = float(value)
                                                elif not isinstance(value, (int, float)):
                                                    if pd.isna(value):
                                                        values.append(None)
                                                        continue
                                                    value = float(value)
                                            except (ValueError, TypeError) as e:
                                                error_msg = f"Column '{db_col}' (NUMERIC) cannot accept value '{value}': {str(e)}"
                                                raise ValueError(error_msg)
                                
                                # Handle boolean conversion for database
                                if isinstance(value, bool):
                                    # For PostgreSQL, use True/False directly
                                    # For MySQL, might need 1/0 depending on column type
                                    values.append(value)
                                elif pd.api.types.is_bool_dtype(type(value)):
                                    values.append(bool(value))
                                else:
                                    values.append(value)
                        else:
                            # This column is NOT NULL but not mapped - use default value
                            if db_col in default_value_columns:
                                values.append(default_value_columns[db_col])
                            else:
                                # Should not happen, but fallback to None
                                values.append(None)
                    
                    # Execute with appropriate parameter style
                    if use_mysql_connector:
                        cursor.execute(sql, tuple(values))
                    else:
                        cursor.execute(sql, values)
                    rows_imported += 1
                
                except Exception as e:
                    rows_failed += 1
                    # Handle different error formats (tuple, string, etc.)
                    if isinstance(e, tuple):
                        # PostgreSQL errors often come as tuples: (error_code, error_message)
                        error_msg = str(e[1]) if len(e) > 1 else str(e[0])
                    else:
                        error_msg = str(e)
                    if len(errors) < 10:
                        logger.error(
                            "Row %d import failed: %s | values=%s | sql=%s",
                            int(idx) + 2, error_msg, values, sql
                        )
                    
                    # Enhance error message with column information and user-friendly explanations
                    enhanced_error = error_msg
                    if db_columns:
                        error_lower = error_msg.lower()
                        
                        # Handle out of range errors (numeric overflow)
                        if 'out of range' in error_lower:
                            # Try to identify which column caused the issue
                            for i, db_col in enumerate(mapped_db_columns):
                                if i < len(values):
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info:
                                        csv_col = next((k for k, v in mapping.items() if v == db_col), db_col)
                                        col_type = db_col_info.get('type', 'unknown').upper()
                                        
                                        # Extract the problematic value from error message if possible
                                        value_match = re.search(r'["\']([^"\']+)["\']', error_msg)
                                        problematic_value = value_match.group(1) if value_match else str(values[i])

                                        if 'REAL' in col_type or 'FLOAT' in col_type or 'DOUBLE' in col_type:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot store the value '{problematic_value}' from CSV column '{csv_col}' because it is too large or too small. REAL/FLOAT columns can only store numbers between approximately -3.4×10³⁸ and 3.4×10³⁸. Please check the value in your CSV file."
                                        elif 'INT' in col_type or 'INTEGER' in col_type:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot store the value '{problematic_value}' from CSV column '{csv_col}' because it is too large or too small. INTEGER columns can only store whole numbers between -2,147,483,648 and 2,147,483,647. Please check the value in your CSV file."
                                        elif 'SMALLINT' in col_type:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot store the value '{problematic_value}' from CSV column '{csv_col}' because it is too large or too small. SMALLINT columns can only store whole numbers between -32,768 and 32,767. Please check the value in your CSV file."
                                        elif 'BIGINT' in col_type:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot store the value '{problematic_value}' from CSV column '{csv_col}' because it is too large or too small. BIGINT columns can only store whole numbers between -9,223,372,036,854,775,808 and 9,223,372,036,854,775,807. Please check the value in your CSV file."
                                        else:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot store the value '{problematic_value}' from CSV column '{csv_col}' because it is outside the allowed range for this data type. Please check the value in your CSV file."
                                        break
                        
                        # Handle invalid input syntax errors (type mismatches)
                        elif 'invalid input syntax' in error_lower or 'invalid literal' in error_lower:
                            # Try to identify which column caused the issue
                            for i, db_col in enumerate(mapped_db_columns):
                                if i < len(values):
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info:
                                        # Find the original CSV column name
                                        csv_col = next((k for k, v in mapping.items() if v == db_col), db_col)
                                        col_type = db_col_info.get('type', 'unknown').upper()
                                        
                                        # Extract the problematic value from error message if possible
                                        value_match = re.search(r'["\']([^"\']+)["\']', error_msg)
                                        problematic_value = value_match.group(1) if value_match else str(values[i])

                                        if 'INT' in col_type:
                                            enhanced_error = f"Column '{db_col}' expects a whole number (integer), but CSV column '{csv_col}' contains the value '{problematic_value}' which is not a valid number. Please check the value in your CSV file."
                                        elif 'REAL' in col_type or 'FLOAT' in col_type or 'DOUBLE' in col_type or 'NUMERIC' in col_type or 'DECIMAL' in col_type:
                                            enhanced_error = f"Column '{db_col}' expects a number (decimal), but CSV column '{csv_col}' contains the value '{problematic_value}' which is not a valid number. Please check the value in your CSV file."
                                        elif 'DATE' in col_type:
                                            enhanced_error = f"Column '{db_col}' expects a date (format: YYYY-MM-DD), but CSV column '{csv_col}' contains the value '{problematic_value}' which is not a valid date. Please check the value in your CSV file."
                                        elif 'TIME' in col_type:
                                            enhanced_error = f"Column '{db_col}' expects a time (format: HH:MM:SS), but CSV column '{csv_col}' contains the value '{problematic_value}' which is not a valid time. Please check the value in your CSV file."
                                        elif 'BOOLEAN' in col_type or 'BOOL' in col_type:
                                            enhanced_error = f"Column '{db_col}' expects true/false (boolean), but CSV column '{csv_col}' contains the value '{problematic_value}' which is not a valid boolean. Please use 'true'/'false', '1'/'0', or 'yes'/'no'."
                                        else:
                                            enhanced_error = f"Column '{db_col}' (type: {col_type}) cannot accept the value '{problematic_value}' from CSV column '{csv_col}'. The value does not match the expected data type. Please check the value in your CSV file."
                                        break
                        
                        # Handle NOT NULL constraint violations
                        elif 'null value' in error_lower or 'not null' in error_lower or 'violates not-null' in error_lower:
                            # Try to identify which column is NOT NULL
                            for i, db_col in enumerate(mapped_db_columns):
                                if i < len(values) and values[i] is None:
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info and not db_col_info.get('nullable', True):
                                        csv_col = next((k for k, v in mapping.items() if v == db_col), db_col)
                                        enhanced_error = f"Column '{db_col}' requires a value (cannot be empty), but CSV column '{csv_col}' has no value in this row. Please provide a value for this column."
                                        break
                        
                        # Handle unique constraint violations
                        elif 'unique constraint' in error_lower or 'duplicate key' in error_lower:
                            enhanced_error = f"This row contains duplicate values that violate a unique constraint in the table. The combination of values in this row already exists in the database. Please check if this row should be unique or if it's a duplicate that should be skipped."
                        
                        # Handle foreign key violations
                        elif 'foreign key' in error_lower or 'violates foreign key' in error_lower:
                            enhanced_error = f"This row references a value that does not exist in another table. The foreign key constraint is violated. Please ensure that the referenced value exists in the related table."
                        
                        # Handle check constraint violations
                        elif 'check constraint' in error_lower or 'violates check' in error_lower:
                            enhanced_error = f"This row violates a check constraint in the table. The values in this row do not meet the required conditions. Please check the values against the table's constraints."
                        
                        # Handle string too long errors
                        elif 'value too long' in error_lower or 'character varying' in error_lower and 'exceeds' in error_lower:
                            for i, db_col in enumerate(mapped_db_columns):
                                if i < len(values):
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info:
                                        csv_col = next((k for k, v in mapping.items() if v == db_col), db_col)
                                        col_type = db_col_info.get('type', 'unknown')
                                        enhanced_error = f"Column '{db_col}' (type: {col_type}) has a maximum length, but CSV column '{csv_col}' contains a value that is too long. Please shorten the value or change the column type to allow longer values."
                                        break
                        
                        # For other errors, try to add column context if possible
                        else:
                            # Try to find column context from the error message
                            for i, db_col in enumerate(mapped_db_columns):
                                if i < len(values) and db_col.lower() in error_lower:
                                    csv_col = next((k for k, v in mapping.items() if v == db_col), db_col)
                                    db_col_info = next((col for col in db_columns if col['name'] == db_col), None)
                                    if db_col_info:
                                        enhanced_error = f"Error in column '{db_col}' (type: {db_col_info.get('type', 'unknown')}), CSV column '{csv_col}', value: '{values[i]}'. {error_msg}"
                                        break
                    
                    errors.append({
                        "row": int(idx) + 2,  # +2 because: 0-indexed + header row
                        "error": enhanced_error[:1000]  # Limit error message length
                    })
            
            # Commit after each chunk
            if hasattr(conn, 'commit'):
                conn.commit()
            elif hasattr(conn, 'autocommit') and conn.autocommit:
                pass  # Already autocommit
            else:
                conn.commit()
    
    except Exception as e:
        if hasattr(conn, 'rollback'):
            conn.rollback()
        raise Exception(f"Import failed: {str(e)}")
    
    finally:
        cursor.close()
    
    logger.info("Import summary: %d imported, %d failed out of %d total", rows_imported, rows_failed, len(df))
    if errors:
        logger.info("First error: row %d – %s", errors[0]['row'], errors[0]['error'])
    
    # Build warnings about default values used
    default_warnings = []
    if default_value_columns:
        for col_name, default_val in default_value_columns.items():
            default_warnings.append(f"Column '{col_name}' (NOT NULL, no default) was filled with default value: {default_val}")
    
    return {
        "rows_imported": rows_imported,
        "rows_failed": rows_failed,
        "total_rows": len(df),
        "errors": errors[:50],  # Return first 50 errors for display
        "error_summary": errors[0]['error'] if errors else None,  # First error as summary
        "default_value_warnings": default_warnings  # Warnings about columns filled with defaults
    }

def convert_column_type(series: pd.Series, target_type: str) -> pd.Series:
    """Convert a pandas Series to the specified type."""
    target_type_upper = target_type.upper()
    
    try:
        if 'INT' in target_type_upper or target_type_upper == 'INTEGER':
            # Convert to integer, handling NaN
            return pd.to_numeric(series, errors='coerce').astype('Int64')  # Nullable integer
        elif 'FLOAT' in target_type_upper or 'REAL' in target_type_upper or 'NUMERIC' in target_type_upper or 'DECIMAL' in target_type_upper:
            # Convert to float
            return pd.to_numeric(series, errors='coerce').astype('float64')
        elif 'BOOL' in target_type_upper:
            # Convert to boolean
            # Handle common boolean representations
            if series.dtype == 'object':
                # Try to convert string representations
                bool_map = {
                    'true': True, 'True': True, 'TRUE': True, '1': True, 1: True,
                    'false': False, 'False': False, 'FALSE': False, '0': False, 0: False,
                    'yes': True, 'Yes': True, 'YES': True,
                    'no': False, 'No': False, 'NO': False
                }
                return series.map(bool_map).astype('boolean')
            else:
                return series.astype('boolean')
        elif 'DATE' in target_type_upper or 'TIME' in target_type_upper:
            # Convert to datetime
            return pd.to_datetime(series, errors='coerce')
        else:
            # Default to string
            return series.astype('string')
    except Exception as e:
        logger.warning("Failed to convert column to %s: %s", target_type, e)
        return series  # Return original if conversion fails

_DEFAULT_KEYWORDS = frozenset({
    'NULL', 'NOW()', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME',
    'GETDATE()', 'GETUTCDATE()', 'TRUE', 'FALSE',
})

def _sanitize_default(value: str) -> str:
    """Return safe SQL DEFAULT fragment. Numbers and known keywords are unquoted;
    everything else is single-quoted with inner quotes escaped."""
    v = value.strip()
    if v.upper() in _DEFAULT_KEYWORDS:
        return v
    try:
        float(v)
        return v  # safe numeric literal
    except ValueError:
        pass
    return "'" + v.replace("'", "''") + "'"


def create_table_from_columns(
    conn,
    engine: str,
    table_name: str,
    schema: Optional[str],
    columns: List[Dict]  # [{"name": "col1", "type": "TEXT", ...}, ...]
) -> None:
    """Create a new table with specified columns."""
    cursor = conn.cursor()
    
    try:
        # Build table name with schema
        if schema:
            if engine == "mysql":
                full_table = f"`{schema}`.`{table_name}`"
            elif engine == "postgresql":
                full_table = f'"{schema}"."{table_name}"'
            elif engine == "sqlserver":
                full_table = f"[{schema}].[{table_name}]"
            else:
                full_table = f"{schema}.{table_name}"
        else:
            if engine == "mysql":
                full_table = f"`{table_name}`"
            elif engine == "postgresql":
                full_table = f'"{table_name}"'
            elif engine == "sqlserver":
                full_table = f"[{table_name}]"
            else:
                full_table = table_name
        
        # Build column definitions
        column_defs = []
        fk_constraints = []
        for col in columns:
            col_name = col['name']
            col_type = col['type']

            # Quote column names based on engine
            if engine == "mysql":
                quoted_name = f"`{col_name}`"
            elif engine == "postgresql":
                quoted_name = f'"{col_name}"'
            elif engine == "sqlserver":
                quoted_name = f"[{col_name}]"
            else:
                quoted_name = col_name

            # Map generic types to engine-specific types
            if engine == "postgresql":
                type_mapping = {
                    "TEXT": "TEXT",
                    "INTEGER": "INTEGER",
                    "REAL": "REAL",
                    "NUMERIC": "NUMERIC",
                    "DATE": "DATE",
                    "DATETIME": "TIMESTAMP",
                    "BOOLEAN": "BOOLEAN",
                    "VARCHAR(255)": "VARCHAR(255)",
                }
            elif engine == "mysql":
                type_mapping = {
                    "TEXT": "TEXT",
                    "INTEGER": "INT",
                    "REAL": "DOUBLE",
                    "NUMERIC": "DECIMAL(10,2)",
                    "DATE": "DATE",
                    "DATETIME": "DATETIME",
                    "BOOLEAN": "BOOLEAN",
                    "VARCHAR(255)": "VARCHAR(255)",
                }
            elif engine == "sqlserver":
                type_mapping = {
                    "TEXT": "NVARCHAR(MAX)",
                    "INTEGER": "INT",
                    "REAL": "FLOAT",
                    "NUMERIC": "DECIMAL(10,2)",
                    "DATE": "DATE",
                    "DATETIME": "DATETIME2",
                    "BOOLEAN": "BIT",
                    "VARCHAR(255)": "NVARCHAR(255)",
                }
            else:
                type_mapping = {
                    "TEXT": "TEXT",
                    "INTEGER": "INTEGER",
                    "REAL": "REAL",
                    "NUMERIC": "NUMERIC",
                    "DATE": "DATE",
                    "DATETIME": "DATETIME",
                    "BOOLEAN": "BOOLEAN",
                    "VARCHAR(255)": "VARCHAR(255)",
                }

            db_type = type_mapping.get(col_type, "TEXT")

            # --- Inline constraints ---
            constraint_parts = []
            if col.get('primaryKey'):
                constraint_parts.append('PRIMARY KEY')
            else:
                if col.get('notNull'):
                    constraint_parts.append('NOT NULL')
                if col.get('unique'):
                    constraint_parts.append('UNIQUE')
            if col.get('defaultValue'):
                constraint_parts.append(f"DEFAULT {_sanitize_default(col['defaultValue'])}")

            column_def = f"{quoted_name} {db_type}"
            if constraint_parts:
                column_def += ' ' + ' '.join(constraint_parts)
            column_defs.append(column_def)

            # Collect FK for table-level REFERENCES clause (added after all column defs)
            if col.get('foreignKeyTable') and col.get('foreignKeyColumn'):
                fk_constraints.append((col_name, col['foreignKeyTable'], col['foreignKeyColumn']))

        # Add FK constraints as table-level definitions
        for (src_col, ref_table, ref_col) in fk_constraints:
            if engine == 'mysql':
                fk_def = f"FOREIGN KEY (`{src_col}`) REFERENCES `{ref_table}`(`{ref_col}`)"
            elif engine == 'postgresql':
                fk_def = f'FOREIGN KEY ("{src_col}") REFERENCES "{ref_table}"("{ref_col}")'
            elif engine == 'sqlserver':
                fk_def = f"FOREIGN KEY ([{src_col}]) REFERENCES [{ref_table}]([{ref_col}])"
            else:
                fk_def = f"FOREIGN KEY ({src_col}) REFERENCES {ref_table}({ref_col})"
            column_defs.append(fk_def)

        # Generate CREATE TABLE SQL
        columns_sql = ", ".join(column_defs)
        create_sql = f"CREATE TABLE {full_table} ({columns_sql})"
        
        cursor.execute(create_sql)
        conn.commit()
    
    finally:
        cursor.close()

