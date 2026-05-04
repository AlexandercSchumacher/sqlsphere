# feature_visualization.py
# Generates interactive dependency visualizations for database objects

import os
import webbrowser
from datetime import datetime

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

def get_default_schema(conn, engine):
    """Get the default schema for the current database connection."""
    cursor = conn.cursor()
    try:
        if engine == "postgresql":
            # PostgreSQL: Get current schema from search_path
            query = "SELECT current_schema()"
            cursor.execute(query)
            result = cursor.fetchone()
            if result and result[0]:
                return result[0]
            # Fallback: Get first schema from search_path
            query = "SHOW search_path"
            cursor.execute(query)
            result = cursor.fetchone()
            if result and result[0]:
                # search_path can be like: "$user", public, schema1
                # Extract the first non-system schema
                schemas = [s.strip().strip('"') for s in result[0].split(',')]
                for schema in schemas:
                    if schema and schema not in ('pg_catalog', 'information_schema', '$user'):
                        return schema
                # If only system schemas, return 'public' as last resort
                return 'public'
        elif engine == "mysql":
            # MySQL: The database name is the schema
            query = "SELECT DATABASE()"
            cursor.execute(query)
            result = cursor.fetchone()
            if result and result[0]:
                return result[0]
        elif engine == "sqlserver":
            # SQL Server: Get default schema for current user
            query = """
            SELECT ISNULL(DEFAULT_SCHEMA, SCHEMA_NAME()) 
            FROM sys.database_principals 
            WHERE name = USER_NAME()
            """
            cursor.execute(query)
            result = cursor.fetchone()
            if result and result[0]:
                return result[0]
            # Fallback: Get current schema
            query = "SELECT SCHEMA_NAME()"
            cursor.execute(query)
            result = cursor.fetchone()
            if result and result[0]:
                return result[0]
            # Last resort: 'dbo' is the default schema in SQL Server
            return 'dbo'
    except Exception as e:
        print(f"WARNING: Could not determine default schema: {str(e)}")
    finally:
        cursor.close()
    
    # Ultimate fallback (should not be reached)
    return None

def get_table_relationships(conn, engine):
    """Get all foreign key relationships between tables."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        query = """
        SELECT 
            OBJECT_SCHEMA_NAME(fk.parent_object_id) AS source_schema,
            OBJECT_NAME(fk.parent_object_id) AS source_table,
            OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS target_schema,
            OBJECT_NAME(fk.referenced_object_id) AS target_table,
            fk.name AS constraint_name,
            COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS source_column,
            COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS target_column
        FROM sys.foreign_keys AS fk
        INNER JOIN sys.foreign_key_columns AS fkc 
            ON fk.object_id = fkc.constraint_object_id
        ORDER BY source_schema, source_table
        """
    elif engine == "postgresql":
        # Use pg_constraint with lateral unnest to correctly handle composite FKs.
        # The information_schema approach produces a cross-join for multi-column FKs,
        # matching every source column with every target column.
        query = """
        SELECT
            nsp.nspname         AS source_schema,
            src.relname         AS source_table,
            rns.nspname         AS target_schema,
            ref.relname         AS target_table,
            con.conname         AS constraint_name,
            sa.attname          AS source_column,
            ra.attname          AS target_column
        FROM pg_constraint con
        JOIN pg_class src       ON src.oid = con.conrelid
        JOIN pg_namespace nsp   ON nsp.oid = src.relnamespace
        JOIN pg_class ref       ON ref.oid = con.confrelid
        JOIN pg_namespace rns   ON rns.oid = ref.relnamespace
        JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS sc(col, ord) ON true
        JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS rc(col, ord) ON sc.ord = rc.ord
        JOIN pg_attribute sa    ON sa.attrelid = con.conrelid  AND sa.attnum = sc.col
        JOIN pg_attribute ra    ON ra.attrelid = con.confrelid AND ra.attnum = rc.col
        WHERE con.contype = 'f'
          AND nsp.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY source_schema, source_table
        """
    else:  # mysql
        query = """
        SELECT 
            kcu.TABLE_SCHEMA AS source_schema,
            kcu.TABLE_NAME AS source_table,
            kcu.REFERENCED_TABLE_SCHEMA AS target_schema,
            kcu.REFERENCED_TABLE_NAME AS target_table,
            kcu.CONSTRAINT_NAME AS constraint_name,
            kcu.COLUMN_NAME AS source_column,
            kcu.REFERENCED_COLUMN_NAME AS target_column
        FROM information_schema.KEY_COLUMN_USAGE kcu
        WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
          AND kcu.TABLE_SCHEMA = DATABASE()
        ORDER BY source_schema, source_table
        """
    
    cursor.execute(query)
    relationships = []
    for row in cursor.fetchall():
        relationships.append({
            'source_schema': safe_extract_value(row[0]),
            'source_table': safe_extract_value(row[1]),
            'target_schema': safe_extract_value(row[2]),
            'target_table': safe_extract_value(row[3]),
            'constraint_name': safe_extract_value(row[4]),
            'source_column': safe_extract_value(row[5]),
            'target_column': safe_extract_value(row[6])
        })
    
    return relationships

def get_all_views(conn, engine):
    """Get list of all views in the database."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        query = """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.VIEWS
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
    elif engine == "postgresql":
        query = """
        SELECT table_schema, table_name
        FROM information_schema.views
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
        """
    else:  # mysql
        query = """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.VIEWS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
        """
    
    cursor.execute(query)
    views = []
    for row in cursor.fetchall():
        views.append({
            'schema': safe_extract_value(row[0]),
            'name': safe_extract_value(row[1]),
            'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
        })
    
    return views

def get_all_procedures(conn, engine):
    """Get list of all stored procedures in the database."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        # Get both procedures and functions
        query = """
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        """
    elif engine == "postgresql":
        # Get both procedures (prokind = 'p') and functions (prokind = 'f')
        query = """
        SELECT n.nspname AS routine_schema, p.proname AS routine_name, p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.prokind IN ('p', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, p.proname
        """
    else:  # mysql
        # Get both procedures and functions
        query = """
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE() 
          AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
        ORDER BY ROUTINE_NAME
        """
    
    cursor.execute(query)
    procedures = []
    for row in cursor.fetchall():
        if engine == "postgresql":
            routine_type = "function" if safe_extract_value(row[2]) == 'f' else "procedure"
            procedures.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}",
                'type': routine_type  # Add type information
            })
        else:
            # For SQL Server and MySQL, row[2] contains ROUTINE_TYPE
            routine_type = "function" if safe_extract_value(row[2]).upper() == 'FUNCTION' else "procedure"
            procedures.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}",
                'type': routine_type
            })
    
    return procedures


def get_all_triggers(conn, engine):
    """Get list of all triggers in the database."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        query = """
        SELECT 
            OBJECT_SCHEMA_NAME(parent_id) AS trigger_schema,
            OBJECT_NAME(parent_id) AS table_name,
            name AS trigger_name
        FROM sys.triggers
        WHERE is_ms_shipped = 0
        ORDER BY trigger_schema, table_name, trigger_name
        """
    elif engine == "postgresql":
        query = """
        SELECT 
            n.nspname AS trigger_schema,
            t.tgname AS trigger_name,
            c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE NOT t.tgisinternal
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, c.relname, t.tgname
        """
    else:  # mysql
        query = """
        SELECT 
            TRIGGER_SCHEMA,
            TRIGGER_NAME,
            EVENT_OBJECT_TABLE AS table_name
        FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
        ORDER BY TRIGGER_NAME
        """
    
    cursor.execute(query)
    triggers = []
    for row in cursor.fetchall():
        if engine == "postgresql":
            triggers.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'table_name': safe_extract_value(row[2]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
            })
        elif engine == "sqlserver":
            triggers.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[2]),
                'table_name': safe_extract_value(row[1]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[2])}"
            })
        else:  # mysql
            triggers.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'table_name': safe_extract_value(row[2]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
            })
    
    return triggers


def get_all_sequences(conn, engine):
    """Get list of all sequences in the database (PostgreSQL only)."""
    cursor = conn.cursor()
    
    if engine == "postgresql":
        query = """
        SELECT 
            n.nspname AS sequence_schema,
            c.relname AS sequence_name
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'S'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, c.relname
        """
        cursor.execute(query)
        sequences = []
        for row in cursor.fetchall():
            sequences.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
            })
        return sequences
    else:
        # Sequences are not directly queryable in MySQL/SQL Server the same way
        # SQL Server uses IDENTITY columns, MySQL uses AUTO_INCREMENT
        return []


def get_all_materialized_views(conn, engine):
    """Get list of all materialized views in the database (PostgreSQL only)."""
    cursor = conn.cursor()
    
    if engine == "postgresql":
        query = """
        SELECT 
            n.nspname AS schema_name,
            c.relname AS view_name
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relkind = 'm'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY n.nspname, c.relname
        """
        cursor.execute(query)
        materialized_views = []
        for row in cursor.fetchall():
            materialized_views.append({
                'schema': safe_extract_value(row[0]),
                'name': safe_extract_value(row[1]),
                'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
            })
        return materialized_views
    else:
        # Materialized views are PostgreSQL-specific
        return []


def get_procedure_table_dependencies(conn, engine, procedures):
    """Analyze procedures/functions to determine which tables they read from or write to.
    Returns a list of dependencies: {'procedure_id': 'schema.proc_name', 'reads_from': ['schema.table'], 'writes_to': ['schema.table']}
    """
    cursor = conn.cursor()
    dependencies = []
    
    # Get default schema for fallback
    default_schema = get_default_schema(conn, engine)
    
    for proc in procedures:
        proc_schema = proc.get('schema')  # Should always be present in metadata
        if not proc_schema:
            # Use default schema as fallback
            proc_schema = default_schema if default_schema else None
            if not proc_schema:
                continue  # Skip if no schema available
        proc_name = proc.get('name', '')
        proc_id = f"{proc_schema}.{proc_name}"
        proc_type = proc.get('type', 'procedure')
        
        reads_from = set()
        writes_to = set()
        
        try:
            if engine == "postgresql":
                # Get procedure/function definition
                cursor.execute("""
                    SELECT pg_get_functiondef(p.oid) AS definition
                    FROM pg_proc p
                    JOIN pg_namespace n ON p.pronamespace = n.oid
                    WHERE n.nspname = ?
                      AND p.proname = ?
                      AND p.prokind IN ('p', 'f')
                """, (proc_schema, proc_name))
                
                row = cursor.fetchone()
                if row and row[0]:
                    definition = safe_extract_value(row[0])
                    # Parse definition to find table references
                    import re
                    
                    # First, handle INSERT INTO ... SELECT ... FROM pattern (most common)
                    # This pattern: INSERT INTO table1 SELECT ... FROM table2
                    # table1 = writes_to, table2 = reads_from
                    insert_select_pattern = r'INSERT\s+INTO\s+(?:([\w]+)\.)?([\w]+)\s+.*?SELECT\s+.*?\s+FROM\s+(?:([\w]+)\.)?([\w]+)'
                    for match in re.finditer(insert_select_pattern, definition, re.IGNORECASE | re.DOTALL):
                        write_schema = match.group(1) or proc_schema
                        write_table = match.group(2)
                        read_schema = match.group(3) or proc_schema
                        read_table = match.group(4)
                        writes_to.add(f"{write_schema}.{write_table}")
                        reads_from.add(f"{read_schema}.{read_table}")
                    
                    # Find other INSERT INTO statements (without SELECT)
                    # Exclude those already matched by INSERT INTO ... SELECT pattern
                    insert_pattern = r'INSERT\s+INTO\s+(?:([\w]+)\.)?([\w]+)'
                    for match in re.finditer(insert_pattern, definition, re.IGNORECASE):
                        # Check if this INSERT is part of INSERT INTO ... SELECT pattern
                        start_pos = match.start()
                        # Look ahead to see if there's a SELECT after this INSERT INTO
                        after = definition[start_pos:start_pos+200].upper()
                        if 'SELECT' not in after[:50]:  # Not part of INSERT INTO ... SELECT
                            schema_name = match.group(1) or proc_schema
                            table_name = match.group(2)
                            # Check if this table wasn't already added by INSERT INTO ... SELECT pattern
                            table_id = f"{schema_name}.{table_name}"
                            if table_id not in writes_to:  # Avoid duplicates
                                writes_to.add(table_id)
                    
                    # Find UPDATE statements
                    update_pattern = r'UPDATE\s+(?:([\w]+)\.)?([\w]+)'
                    for match in re.finditer(update_pattern, definition, re.IGNORECASE):
                        schema_name = match.group(1) or proc_schema
                        table_name = match.group(2)
                        writes_to.add(f"{schema_name}.{table_name}")
                    
                    # Find DELETE FROM statements
                    delete_pattern = r'DELETE\s+FROM\s+(?:([\w]+)\.)?([\w]+)'
                    for match in re.finditer(delete_pattern, definition, re.IGNORECASE):
                        schema_name = match.group(1) or proc_schema
                        table_name = match.group(2)
                        writes_to.add(f"{schema_name}.{table_name}")
                    
                    # Find SELECT ... FROM statements (but NOT those already matched in INSERT INTO ... SELECT)
                    # We need to find standalone SELECT statements
                    select_pattern = r'SELECT\s+.*?\s+FROM\s+(?:([\w]+)\.)?([\w]+)'
                    for match in re.finditer(select_pattern, definition, re.IGNORECASE | re.DOTALL):
                        # Check if this SELECT is part of INSERT INTO ... SELECT pattern
                        start_pos = match.start()
                        # Look backwards to see if there's an INSERT INTO before this SELECT
                        before = definition[max(0, start_pos-100):start_pos].upper()
                        if 'INSERT' not in before or 'INTO' not in before[-50:]:
                            # This is a standalone SELECT, not part of INSERT INTO ... SELECT
                            schema_name = match.group(1) or proc_schema
                            table_name = match.group(2)
                            # Check if this table wasn't already added by INSERT INTO ... SELECT pattern
                            table_id = f"{schema_name}.{table_name}"
                            if table_id not in reads_from:  # Avoid duplicates
                                reads_from.add(table_id)
                    
            elif engine == "mysql":
                # Get procedure/function definition
                cursor.execute("""
                    SELECT ROUTINE_DEFINITION
                    FROM INFORMATION_SCHEMA.ROUTINES
                    WHERE ROUTINE_SCHEMA = ?
                      AND ROUTINE_NAME = ?
                      AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
                """, (proc_schema, proc_name))
                
                row = cursor.fetchone()
                if row and row[0]:
                    definition = safe_extract_value(row[0])
                    import re
                    
                    insert_pattern = r'INSERT\s+INTO\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(insert_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    update_pattern = r'UPDATE\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(update_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    delete_pattern = r'DELETE\s+FROM\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(delete_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    select_pattern = r'FROM\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(select_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        reads_from.add(f"{proc_schema}.{table_name}")
                    
            elif engine == "sqlserver":
                # Get procedure/function definition
                cursor.execute("""
                    SELECT OBJECT_DEFINITION(OBJECT_ID(?))
                """, (f"{proc_schema}.{proc_name}",))
                
                row = cursor.fetchone()
                if row and row[0]:
                    definition = safe_extract_value(row[0])
                    import re
                    
                    insert_pattern = r'INSERT\s+INTO\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(insert_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    update_pattern = r'UPDATE\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(update_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    delete_pattern = r'DELETE\s+FROM\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(delete_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        writes_to.add(f"{proc_schema}.{table_name}")
                    
                    select_pattern = r'FROM\s+(?:[\w\.]+\.)?([\w]+)'
                    for match in re.finditer(select_pattern, definition, re.IGNORECASE):
                        table_name = match.group(1)
                        reads_from.add(f"{proc_schema}.{table_name}")
        
        except Exception as e:
            # If we can't parse the procedure, skip it
            print(f"Error parsing procedure {proc_id}: {e}")
            continue
        
        if reads_from or writes_to:
            dependencies.append({
                'procedure_id': proc_id,
                'procedure_name': proc_name,
                'procedure_schema': proc_schema,
                'procedure_type': proc_type,
                'reads_from': list(reads_from),
                'writes_to': list(writes_to)
            })
    
    return dependencies


def get_view_dependencies(conn, engine):
    """Get view dependencies (what tables/views they reference)."""
    cursor = conn.cursor()
    dependencies = []
    
    if engine == "mysql":
        # Get list of views first
        cursor.execute("""
            SELECT TABLE_NAME 
            FROM information_schema.VIEWS 
            WHERE TABLE_SCHEMA = DATABASE()
        """)
        view_names = [safe_extract_value(row[0]) for row in cursor.fetchall()]
        
        import re
        
        # For each view, use SHOW CREATE VIEW to get definition
        for view_name in view_names:
            try:
                cursor.execute(f"SHOW CREATE VIEW `{view_name}`")
                result = cursor.fetchone()
                if result and len(result) >= 2:
                    view_def = result[1]  # CREATE VIEW statement is in second column
                    
                    # Parse view definition for table references
                    # Look for FROM and JOIN clauses with backtick-quoted names
                    # Handles: `schema`.`table`, `table`, schema.table
                    tables = set()
                    
                    # Pattern to match: `schema`.`table` or `table` or schema.table
                    # After FROM or JOIN
                    patterns = [
                        r'\b(?:FROM|JOIN)\s+`([^`]+)`\.`([^`]+)`',  # `schema`.`table`
                        r'\b(?:FROM|JOIN)\s+`([^`]+)`',              # `table`
                        r'\b(?:FROM|JOIN)\s+(\w+)\.(\w+)',           # schema.table
                        r'\b(?:FROM|JOIN)\s+(\w+)',                  # table
                    ]
                    
                    for pattern in patterns:
                        for match in re.finditer(pattern, view_def, re.IGNORECASE):
                            if len(match.groups()) == 2:
                                # schema.table format
                                schema_name, table_name = match.group(1), match.group(2)
                                # Only use table name, we'll prefix it later
                                tables.add(table_name)
                            else:
                                # just table name
                                table_name = match.group(1)
                                if table_name.lower() not in ('select', 'where', 'group', 'order', 'having', 'as', 'on'):
                                    tables.add(table_name)
                    
                    for table in tables:
                        dependencies.append({
                            'source': view_name,
                            'target': table,
                            'type': 'view_dependency'
                        })
            except Exception as e:
                # Skip views we can't read (shouldn't happen with proper permissions)
                print(f"Warning: Could not read view {view_name}: {e}")
                continue
    elif engine == "postgresql":
        cursor.execute(
            """
            SELECT 
                vtu.view_schema,
                vtu.view_name,
                vtu.table_schema,
                vtu.table_name
            FROM information_schema.view_table_usage vtu
            WHERE vtu.view_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY vtu.view_schema, vtu.view_name
            """
        )
        for row in cursor.fetchall():
            view_schema, view_name, table_schema, table_name = row
            dependencies.append({
                'schema': view_schema,
                'source': view_name,
                'target': f"{table_schema}.{table_name}",
                'type': 'view_dependency'
            })
    elif engine == "sqlserver":
        # SQL Server: Use sys.sql_expression_dependencies to find view dependencies
        cursor.execute("""
            SELECT DISTINCT
                OBJECT_SCHEMA_NAME(referencing_id) AS view_schema,
                OBJECT_NAME(referencing_id) AS view_name,
                OBJECT_SCHEMA_NAME(referenced_id) AS table_schema,
                OBJECT_NAME(referenced_id) AS table_name
            FROM sys.sql_expression_dependencies
            WHERE referencing_id IN (
                SELECT object_id 
                FROM sys.views
            )
            AND referenced_id IN (
                SELECT object_id 
                FROM sys.tables
            )
            ORDER BY view_schema, view_name
        """)
        
        for row in cursor.fetchall():
            view_schema, view_name, table_schema, table_name = row
            if view_schema and view_name and table_schema and table_name:
                dependencies.append({
                    'schema': view_schema,
                    'source': view_name,
                    'target': f"{table_schema}.{table_name}",
                    'type': 'view_dependency'
                })
    
    return dependencies

def get_all_tables(conn, engine):
    """Get list of all tables in the database."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        query = """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
    elif engine == "postgresql":
        query = """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
        """
    else:  # mysql
        query = """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
    
    cursor.execute(query)
    tables = []
    for row in cursor.fetchall():
        tables.append({
            'schema': safe_extract_value(row[0]),
            'name': safe_extract_value(row[1]),
            'full_name': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}"
        })
    
    return tables

def get_column_info(conn, engine, schema=None, table=None):
    """Get detailed column information with data types."""
    cursor = conn.cursor()
    
    if engine == "sqlserver":
        query = """
        SELECT 
            TABLE_SCHEMA,
            TABLE_NAME,
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE 1=1
        """
        if schema:
            query += f" AND TABLE_SCHEMA = '{schema}'"
        if table:
            query += f" AND TABLE_NAME = '{table}'"
        query += " ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    elif engine == "postgresql":
        query = """
        SELECT 
            table_schema,
            table_name,
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        """
        if schema:
            query += f" AND table_schema = '{schema}'"
        if table:
            query += f" AND table_name = '{table}'"
        query += " ORDER BY table_schema, table_name, ordinal_position"
    else:  # mysql
        # Use the provided schema when available; fall back to DATABASE()
        schema_filter = f"TABLE_SCHEMA = '{schema}'" if schema else "TABLE_SCHEMA = DATABASE()"
        query = f"""
        SELECT
            TABLE_SCHEMA,
            TABLE_NAME,
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE {schema_filter}
        """
        if table:
            query += f" AND TABLE_NAME = '{table}'"
        query += " ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    
    # Short type name mapping for common verbose types
    _SHORT = {
        'character varying': 'varchar',
        'timestamp without time zone': 'timestamp',
        'timestamp with time zone': 'timestamptz',
        'double precision': 'float8',
        'character': 'char',
        'boolean': 'bool',
        'integer': 'int4',
        'bigint': 'int8',
        'smallint': 'int2',
        'numeric': 'numeric',
    }

    cursor.execute(query)
    columns = []
    for row in cursor.fetchall():
        raw_nullable = safe_extract_value(row[4])
        # Normalise to Python bool: IS_NULLABLE returns 'YES'/'NO' strings
        if isinstance(raw_nullable, str):
            is_null = raw_nullable.strip().upper() == 'YES'
        else:
            is_null = bool(raw_nullable)
        raw_type = safe_extract_value(row[3]) or ''
        short_type = _SHORT.get(raw_type.lower(), raw_type)
        columns.append({
            'schema': safe_extract_value(row[0]),
            'table': safe_extract_value(row[1]),
            'column': safe_extract_value(row[2]),
            'data_type': raw_type,
            'data_type_short': short_type,
            'nullable': is_null,
            'default': safe_extract_value(row[5]) if len(row) > 5 else None,
            'is_primary_key': False  # Will be set later
        })

    return columns

def get_column_dependencies(conn, engine, schema, table, column):
    """
    Get all dependencies for a specific column:
    - Upstream: What influences this column (FKs from other tables, procedures, triggers, etc.)
    - Downstream: What is influenced by this column (FKs to other tables, procedures, triggers, etc.)
    """
    cursor = conn.cursor()
    dependencies = {
        'upstream': [],  # What influences this column
        'downstream': []  # What is influenced by this column
    }
    
    # 1. Foreign Key relationships (upstream: columns that reference this column)
    #    (downstream: columns that this column references)
    if engine == "postgresql":
        # Upstream: Find columns that reference this column
        cursor.execute("""
            SELECT 
                tc.table_schema AS source_schema,
                tc.table_name AS source_table,
                kcu.column_name AS source_column,
                tc.constraint_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
               AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_schema = ?
              AND ccu.table_name = ?
              AND ccu.column_name = ?
              AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        """, (schema, table, column))
        
        for row in cursor.fetchall():
            dependencies['upstream'].append({
                'type': 'foreign_key',
                'source_schema': safe_extract_value(row[0]),
                'source_table': safe_extract_value(row[1]),
                'source_column': safe_extract_value(row[2]),
                'target_schema': schema,
                'target_table': table,
                'target_column': column,
                'constraint_name': safe_extract_value(row[3]),
                'description': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}.{safe_extract_value(row[2])} references {schema}.{table}.{column}"
            })
        
        # Downstream: Find columns that this column references
        cursor.execute("""
            SELECT 
                ccu.table_schema AS target_schema,
                ccu.table_name AS target_table,
                ccu.column_name AS target_column,
                tc.constraint_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
               AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
               AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = ?
              AND tc.table_name = ?
              AND kcu.column_name = ?
              AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        """, (schema, table, column))
        
        for row in cursor.fetchall():
            dependencies['downstream'].append({
                'type': 'foreign_key',
                'source_schema': schema,
                'source_table': table,
                'source_column': column,
                'target_schema': safe_extract_value(row[0]),
                'target_table': safe_extract_value(row[1]),
                'target_column': safe_extract_value(row[2]),
                'constraint_name': safe_extract_value(row[3]),
                'description': f"{schema}.{table}.{column} references {safe_extract_value(row[0])}.{safe_extract_value(row[1])}.{safe_extract_value(row[2])}"
            })
        
        # 2. Procedures and Functions that use this column
        # Get all procedures/functions and check their definitions
        cursor.execute("""
            SELECT 
                n.nspname AS routine_schema,
                p.proname AS routine_name,
                p.prokind,
                pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE p.prokind IN ('p', 'f')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        """)
        
        for row in cursor.fetchall():
            routine_schema, routine_name, prokind, definition = row
            routine_type = "function" if prokind == 'f' else "procedure"
            full_table_ref = f"{schema}.{table}"
            column_ref = f"{full_table_ref}.{column}"
            
            # Check if definition contains the column reference
            if column_ref.lower() in definition.lower() or f'"{column}"' in definition:
                dependencies['upstream'].append({
                    'type': routine_type,
                    'schema': routine_schema,
                    'name': routine_name,
                    'full_name': f"{routine_schema}.{routine_name}",
                    'description': f"{routine_type.capitalize()} {routine_schema}.{routine_name} uses {column_ref}"
                })
                dependencies['downstream'].append({
                    'type': routine_type,
                    'schema': routine_schema,
                    'name': routine_name,
                    'full_name': f"{routine_schema}.{routine_name}",
                    'description': f"{routine_type.capitalize()} {routine_schema}.{routine_name} uses {column_ref}"
                })
        
        # 3. Triggers that use this column
        cursor.execute("""
            SELECT 
                n.nspname AS trigger_schema,
                t.tgname AS trigger_name,
                c.relname AS table_name,
                pg_get_triggerdef(t.oid) AS definition
            FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE NOT t.tgisinternal
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND c.relname = ?
              AND n.nspname = ?
        """, (table, schema))
        
        for row in cursor.fetchall():
            trigger_schema, trigger_name, table_name, definition = row
            column_ref = f"{schema}.{table}.{column}"
            
            if column_ref.lower() in definition.lower() or f'"{column}"' in definition:
                dependencies['upstream'].append({
                    'type': 'trigger',
                    'schema': trigger_schema,
                    'name': trigger_name,
                    'table_name': table_name,
                    'full_name': f"{trigger_schema}.{trigger_name}",
                    'description': f"Trigger {trigger_schema}.{trigger_name} on {table_name} uses {column_ref}"
                })
                dependencies['downstream'].append({
                    'type': 'trigger',
                    'schema': trigger_schema,
                    'name': trigger_name,
                    'table_name': table_name,
                    'full_name': f"{trigger_schema}.{trigger_name}",
                    'description': f"Trigger {trigger_schema}.{trigger_name} on {table_name} uses {column_ref}"
                })
        
        # 4. Views that use this column
        cursor.execute("""
            SELECT 
                vtu.view_schema,
                vtu.view_name
            FROM information_schema.view_table_usage vtu
            WHERE vtu.table_schema = ?
              AND vtu.table_name = ?
              AND vtu.view_schema NOT IN ('pg_catalog', 'information_schema')
        """, (schema, table))
        
        for row in cursor.fetchall():
            view_schema, view_name = row
            # Check if the view actually uses this specific column
            # We need to get the view definition
            cursor.execute("""
                SELECT definition
                FROM pg_views
                WHERE schemaname = ?
                  AND viewname = ?
            """, (view_schema, view_name))
            
            view_def_result = cursor.fetchone()
            if view_def_result:
                view_def = view_def_result[0]
                column_ref = f"{schema}.{table}.{column}"
                if column_ref.lower() in view_def.lower() or f'"{column}"' in view_def:
                    dependencies['upstream'].append({
                        'type': 'view',
                        'schema': view_schema,
                        'name': view_name,
                        'full_name': f"{view_schema}.{view_name}",
                        'description': f"View {view_schema}.{view_name} uses {column_ref}"
                    })
                    dependencies['downstream'].append({
                        'type': 'view',
                        'schema': view_schema,
                        'name': view_name,
                        'full_name': f"{view_schema}.{view_name}",
                        'description': f"View {view_schema}.{view_name} uses {column_ref}"
                    })
    
    elif engine == "mysql":
        # Upstream: Find columns that reference this column
        cursor.execute("""
            SELECT 
                kcu.TABLE_SCHEMA AS source_schema,
                kcu.TABLE_NAME AS source_table,
                kcu.COLUMN_NAME AS source_column,
                kcu.CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE kcu
            WHERE kcu.REFERENCED_TABLE_SCHEMA = ?
              AND kcu.REFERENCED_TABLE_NAME = ?
              AND kcu.REFERENCED_COLUMN_NAME = ?
        """, (schema, table, column))
        
        for row in cursor.fetchall():
            dependencies['upstream'].append({
                'type': 'foreign_key',
                'source_schema': safe_extract_value(row[0]),
                'source_table': safe_extract_value(row[1]),
                'source_column': safe_extract_value(row[2]),
                'target_schema': schema,
                'target_table': table,
                'target_column': column,
                'constraint_name': safe_extract_value(row[3]),
                'description': f"{safe_extract_value(row[0])}.{safe_extract_value(row[1])}.{safe_extract_value(row[2])} references {schema}.{table}.{column}"
            })
        
        # Downstream: Find columns that this column references
        cursor.execute("""
            SELECT 
                kcu.REFERENCED_TABLE_SCHEMA AS target_schema,
                kcu.REFERENCED_TABLE_NAME AS target_table,
                kcu.REFERENCED_COLUMN_NAME AS target_column,
                kcu.CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE kcu
            WHERE kcu.TABLE_SCHEMA = ?
              AND kcu.TABLE_NAME = ?
              AND kcu.COLUMN_NAME = ?
              AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        """, (schema, table, column))
        
        for row in cursor.fetchall():
            dependencies['downstream'].append({
                'type': 'foreign_key',
                'source_schema': schema,
                'source_table': table,
                'source_column': column,
                'target_schema': safe_extract_value(row[0]),
                'target_table': safe_extract_value(row[1]),
                'target_column': safe_extract_value(row[2]),
                'constraint_name': safe_extract_value(row[3]),
                'description': f"{schema}.{table}.{column} references {safe_extract_value(row[0])}.{safe_extract_value(row[1])}.{safe_extract_value(row[2])}"
            })
        
        # Procedures and Functions
        cursor.execute("""
            SELECT 
                ROUTINE_SCHEMA,
                ROUTINE_NAME,
                ROUTINE_TYPE,
                ROUTINE_DEFINITION
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_SCHEMA = DATABASE()
              AND ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
        """)
        
        for row in cursor.fetchall():
            routine_schema, routine_name, routine_type, definition = row
            if definition:
                column_ref = f"`{table}`.`{column}`" or f"{table}.{column}"
                if column_ref.lower() in definition.lower() or f"`{column}`" in definition:
                    dependencies['upstream'].append({
                        'type': routine_type.lower(),
                        'schema': routine_schema,
                        'name': routine_name,
                        'full_name': f"{routine_schema}.{routine_name}",
                        'description': f"{routine_type.capitalize()} {routine_schema}.{routine_name} uses {column_ref}"
                    })
                    dependencies['downstream'].append({
                        'type': routine_type.lower(),
                        'schema': routine_schema,
                        'name': routine_name,
                        'full_name': f"{routine_schema}.{routine_name}",
                        'description': f"{routine_type.capitalize()} {routine_schema}.{routine_name} uses {column_ref}"
                    })
        
        # Triggers
        cursor.execute("""
            SELECT 
                TRIGGER_SCHEMA,
                TRIGGER_NAME,
                EVENT_OBJECT_TABLE,
                ACTION_STATEMENT
            FROM INFORMATION_SCHEMA.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE()
              AND EVENT_OBJECT_TABLE = ?
        """, (table,))
        
        for row in cursor.fetchall():
            trigger_schema, trigger_name, table_name, action_statement = row
            if action_statement:
                column_ref = f"`{column}`" or column
                if column_ref.lower() in action_statement.lower():
                    dependencies['upstream'].append({
                        'type': 'trigger',
                        'schema': trigger_schema,
                        'name': trigger_name,
                        'table_name': table_name,
                        'full_name': f"{trigger_schema}.{trigger_name}",
                        'description': f"Trigger {trigger_schema}.{trigger_name} on {table_name} uses {column_ref}"
                    })
                    dependencies['downstream'].append({
                        'type': 'trigger',
                        'schema': trigger_schema,
                        'name': trigger_name,
                        'table_name': table_name,
                        'full_name': f"{trigger_schema}.{trigger_name}",
                        'description': f"Trigger {trigger_schema}.{trigger_name} on {table_name} uses {column_ref}"
                    })
        
        # Views for MySQL
        cursor.execute("""
            SELECT 
                TABLE_SCHEMA,
                TABLE_NAME,
                VIEW_DEFINITION
            FROM INFORMATION_SCHEMA.VIEWS
            WHERE TABLE_SCHEMA = DATABASE()
        """)
        
        for row in cursor.fetchall():
            view_schema, view_name, view_definition = row
            if view_definition:
                column_ref = f"`{table}`.`{column}`" or f"{table}.{column}"
                if column_ref.lower() in view_definition.lower() or f"`{column}`" in view_definition:
                    dependencies['upstream'].append({
                        'type': 'view',
                        'schema': view_schema,
                        'name': view_name,
                        'full_name': f"{view_schema}.{view_name}",
                        'description': f"View {view_schema}.{view_name} uses {column_ref}"
                    })
                    dependencies['downstream'].append({
                        'type': 'view',
                        'schema': view_schema,
                        'name': view_name,
                        'full_name': f"{view_schema}.{view_name}",
                        'description': f"View {view_schema}.{view_name} uses {column_ref}"
                    })
    
    return dependencies

def generate_visualization_data(relationships, view_deps, columns, level='table', filter_obj=None, views=None, column_dependencies=None, selected_column=None, all_tables=None, show_all_columns=False, conn=None, engine=None, enabled_object_types=None, procedures=None, triggers=None, sequences=None, materialized_views=None, procedure_deps=None, show_only_connected_tables=False):
    """Generate visualization data as JSON for frontend rendering.
    
    Returns a dictionary with:
    - nodes: List of node objects with id, label, type, schema, columns, etc.
    - edges: List of edge objects with from, to, label, type, etc.
    - metadata: Additional information about the visualization
    """
    from feature_import import get_primary_key_columns
    
    # Get default schema for fallback when schema is missing from metadata
    default_schema = None
    if conn is not None and engine is not None:
        default_schema = get_default_schema(conn, engine)
    
    nodes = []
    edges = []
    node_ids = set()
    
    if level == 'database':
        # Show all schemas
        schemas = set()
        for rel in relationships:
            schemas.add(rel['source_schema'])
            schemas.add(rel['target_schema'])
        
        for schema in schemas:
            nodes.append({
                'id': schema,
                'label': schema,
                'type': 'schema',
                'title': f'Schema: {schema}'
            })
            node_ids.add(schema)
    
    elif level == 'schema' or level == 'table':
        # Collect all tables that should be displayed
        tables_to_show = {}
        
        # First, collect tables from relationships
        for rel in relationships:
            source_id = f"{rel['source_schema']}.{rel['source_table']}"
            target_id = f"{rel['target_schema']}.{rel['target_table']}"
            
            # Filter by specific object if provided
            if filter_obj:
                if '.' not in filter_obj:
                    # Filter by schema only
                    if rel['source_schema'] != filter_obj and rel['target_schema'] != filter_obj:
                        continue
                else:
                    # Filter by specific table (schema.table format)
                    if filter_obj not in [source_id, target_id]:
                        continue
            
            if source_id not in tables_to_show:
                tables_to_show[source_id] = {
                    'schema': rel['source_schema'],
                    'table': rel['source_table'],
                    'columns': [],
                    'relationships': []
                }
            
            if target_id not in tables_to_show:
                tables_to_show[target_id] = {
                    'schema': rel['target_schema'],
                    'table': rel['target_table'],
                    'columns': [],
                    'relationships': []
                }
            
            # Store relationship info
            tables_to_show[source_id]['relationships'].append({
                'type': 'fk_out',
                'column': rel['source_column'],
                'target_table': target_id,
                'target_column': rel['target_column'],
                'constraint': rel['constraint_name']
            })
        
        # Collect all tables that appear in relationships (for filtering)
        tables_in_relationships = set()
        for rel in relationships:
            source_id = f"{rel['source_schema']}.{rel['source_table']}"
            target_id = f"{rel['target_schema']}.{rel['target_table']}"
            tables_in_relationships.add(source_id)
            tables_in_relationships.add(target_id)
        
        # Also check procedure dependencies for connected tables
        if procedure_deps:
            for dep in procedure_deps:
                for table_id in dep.get('reads_from', []):
                    if '.' not in table_id:
                        table_id = f"{dep['procedure_schema']}.{table_id}"
                    tables_in_relationships.add(table_id)
                for table_id in dep.get('writes_to', []):
                    if '.' not in table_id:
                        table_id = f"{dep['procedure_schema']}.{table_id}"
                    tables_in_relationships.add(table_id)
        
        # If filter_obj is a specific table (schema.table format), ensure it's included
        # even if it has no relationships - this handles the case where a user selects
        # a table that has no foreign keys or is not referenced by any other table
        if filter_obj and '.' in filter_obj:
            if filter_obj not in tables_to_show:
                # Parse schema and table name
                parts = filter_obj.split('.')
                if len(parts) == 2:
                    schema_name, table_name = parts
                    tables_to_show[filter_obj] = {
                        'schema': schema_name,
                        'table': table_name,
                        'columns': [],
                        'relationships': []
                    }
        
        # Add all tables from all_tables if filtering by schema
        if all_tables and filter_obj and '.' not in filter_obj:
            for table in all_tables:
                table_id = f"{table['schema']}.{table['name']}"
                if table['schema'] == filter_obj and table_id not in tables_to_show:
                    # If show_only_connected_tables is True, only add tables that have connections
                    if show_only_connected_tables and table_id not in tables_in_relationships:
                        continue
                    tables_to_show[table_id] = {
                        'schema': table['schema'],
                        'table': table['name'],
                        'columns': [],
                        'relationships': []
                    }
        elif all_tables and not filter_obj:
            # No filter - add all tables
            for table in all_tables:
                table_id = f"{table['schema']}.{table['name']}"
                if table_id not in tables_to_show:
                    # If show_only_connected_tables is True, only add tables that have connections
                    if show_only_connected_tables and table_id not in tables_in_relationships:
                        continue
                    tables_to_show[table_id] = {
                        'schema': table['schema'],
                        'table': table['name'],
                        'columns': [],
                        'relationships': []
                    }
        
        # Get column information for all tables and identify primary keys and foreign keys
        fk_columns = set()
        target_tables_with_fk = set()
        target_table_pk_columns = {}
        
        # Use all relationships to identify target tables
        for rel in relationships:
            source_id = f"{rel['source_schema']}.{rel['source_table']}"
            target_id = f"{rel['target_schema']}.{rel['target_table']}"
            source_col_id = f"{rel['source_schema']}.{rel['source_table']}.{rel['source_column']}"
            fk_columns.add(source_col_id)
            
            target_tables_with_fk.add(target_id)
            if target_id not in target_table_pk_columns:
                target_table_pk_columns[target_id] = set()
            target_table_pk_columns[target_id].add(rel['target_column'])
        
        for table_id, table_info in tables_to_show.items():
            table_columns = [c for c in columns if f"{c['schema']}.{c['table']}" == table_id]

            # Get primary key columns for this table.
            # When conn is None (e.g. local agent path where PKs are pre-computed in
            # the column dicts), we skip the DB call and keep the existing values.
            fetch_pk = conn is not None and engine is not None
            pk_set = set()
            if fetch_pk:
                try:
                    schema_name = table_info.get('schema')
                    table_name = table_info.get('table')
                    pk_columns = get_primary_key_columns(conn, engine, table_name, schema_name)
                    pk_set = set(pk_columns)
                except Exception:
                    pk_set = set()

            # Mark primary keys and foreign keys
            is_target_table = table_id in target_tables_with_fk
            referenced_pk_columns = target_table_pk_columns.get(table_id, set())

            for col in table_columns:
                col_id = f"{col['schema']}.{col['table']}.{col['column']}"
                if fetch_pk:
                    col['is_primary_key'] = col['column'] in pk_set
                elif 'is_primary_key' not in col:
                    col['is_primary_key'] = False
                col['is_foreign_key'] = col_id in fk_columns
                col['is_referenced_pk'] = (
                    col.get('is_primary_key', False) and col['column'] in referenced_pk_columns
                )
            
            tables_to_show[table_id]['columns'] = table_columns
            tables_to_show[table_id]['is_target_table'] = is_target_table
        
        # Sort tables by name for consistent display
        sorted_tables = sorted(tables_to_show.items(), key=lambda x: x[1]['table'].lower())
        
        # Check if tables should be shown
        show_tables = enabled_object_types is None or 'tables' in enabled_object_types
        
        # Create table nodes
        for table_id, table_info in sorted_tables:
            if not show_tables:
                continue
            
            has_relationships = len(table_info.get('relationships', [])) > 0
            is_target_table = table_info.get('is_target_table', False)
            has_any_connection = has_relationships or is_target_table
            
            table_columns_list = table_info.get('columns', [])
            
            # Filter columns based on show_all_columns and connections
            filtered_columns = []
            if table_columns_list:
                sorted_columns = sorted(
                    table_columns_list,
                    key=lambda c: (
                        0 if c.get('is_primary_key') else 1 if c.get('is_foreign_key') else 2,
                        c['column']
                    )
                )
                
                for col in sorted_columns:
                    if show_all_columns:
                        filtered_columns.append(col)
                    elif has_any_connection:
                        should_show = False
                        if col.get('is_foreign_key'):
                            should_show = True
                        if col.get('is_primary_key'):
                            if col.get('is_referenced_pk') or is_target_table:
                                should_show = True
                        if should_show:
                            filtered_columns.append(col)
            
            # Shorten data type names
            for col in filtered_columns:
                data_type = col['data_type']
                if 'character varying' in data_type.lower():
                    col['data_type_short'] = 'varchar'
                elif 'timestamp without time zone' in data_type.lower():
                    col['data_type_short'] = 'timestamp'
                elif 'timestamp with time zone' in data_type.lower():
                    col['data_type_short'] = 'timestamptz'
                elif 'integer' in data_type.lower():
                    col['data_type_short'] = 'int'
                else:
                    col['data_type_short'] = data_type
            
            # Create node data structure
            node_data = {
                'id': table_id,
                'label': table_info['table'],
                'type': 'table',
                'schema': table_info['schema'],
                'title': f"Table: {table_id}\nColumns: {len(table_columns_list)}",
                'column_count': len(table_columns_list),
                'columns': filtered_columns,  # Only include filtered columns
                'collapsed': False  # Default to expanded
            }
            
            nodes.append(node_data)
            node_ids.add(table_id)
        
        # Create edges for relationships
        if show_tables:
            for rel in relationships:
                source_id = f"{rel['source_schema']}.{rel['source_table']}"
                target_id = f"{rel['target_schema']}.{rel['target_table']}"
                
                # Filter by specific object if provided
                if filter_obj:
                    if '.' not in filter_obj:
                        if rel['source_schema'] != filter_obj and rel['target_schema'] != filter_obj:
                            continue
                    else:
                        if filter_obj not in [source_id, target_id]:
                            continue
                
                # Only add edge if both nodes exist
                if source_id in node_ids and target_id in node_ids:
                    edges.append({
                        'id': f"fk_{rel['constraint_name']}_{rel['source_column']}",
                        'from': source_id,
                        'to': target_id,
                        'label': f"{rel['source_column']} → {rel['target_column']}",
                        'title': f"FK: {rel['constraint_name']}\n{rel['source_table']}.{rel['source_column']} → {rel['target_table']}.{rel['target_column']}",
                        'type': 'foreign_key',
                        'sourceColumn': rel['source_column'],
                        'targetColumn': rel['target_column'],
                        'dashed': False
                    })
        
        # Add views as nodes
        show_views = enabled_object_types is None or 'views' in enabled_object_types
        # Build set of view IDs that have dependencies on the selected table
        views_referencing_filter = set()
        if filter_obj and '.' in filter_obj and show_views:
            for dep in view_deps:
                view_schema = dep.get('schema') or default_schema
                if not view_schema:
                    continue
                target_name = dep['target']
                target_id = f"{view_schema}.{target_name}" if '.' not in target_name else target_name
                if target_id == filter_obj:
                    views_referencing_filter.add(f"{view_schema}.{dep['source']}")

        if views and show_views:
            for view in views:
                view_id = f"{view['schema']}.{view['name']}"

                # Filter by schema or specific view/table
                if filter_obj:
                    if '.' not in filter_obj:
                        if view['schema'] != filter_obj:
                            continue
                    else:
                        if filter_obj not in [view_id, view['name']] and view_id not in views_referencing_filter:
                            continue
                
                if view_id not in node_ids:
                    nodes.append({
                        'id': view_id,
                        'label': view['name'],
                        'type': 'view',
                        'schema': view['schema'],
                        'title': f"View: {view_id}"
                    })
                    node_ids.add(view_id)
        
        # Add view dependencies
        if show_views:
            for dep in view_deps:
                view_schema = dep.get('schema')
                if not view_schema:
                    view_schema = default_schema if default_schema else None
                    if not view_schema:
                        continue
                view_id = f"{view_schema}.{dep['source']}"
                target_name = dep['target']
                if '.' not in target_name:
                    table_id = f"{view_schema}.{target_name}"
                else:
                    table_id = target_name
                
                if not show_tables:
                    continue
                
                # Filter by schema or specific objects
                if filter_obj:
                    if '.' not in filter_obj:
                        target_schema = table_id.split('.')[0] if '.' in table_id else view_schema
                        if view_schema != filter_obj and target_schema != filter_obj:
                            continue
                    else:
                        if filter_obj not in [view_id, table_id]:
                            continue
                
                # Only add edge if both nodes exist
                if view_id in node_ids and table_id in node_ids:
                    edges.append({
                        'id': f"view_dep_{dep['source']}_{target_name}",
                        'from': view_id,
                        'to': table_id,
                        'title': f"View '{dep['source']}' reads from '{target_name}'",
                        'label': 'reads from',
                        'type': 'view_dependency',
                        'dashed': True,
                        'color': '#FB7E81'
                    })
        
        # Add procedures and functions
        show_procedures = enabled_object_types is None or 'procedures' in enabled_object_types
        show_functions = enabled_object_types is None or 'functions' in enabled_object_types
        # Build set of procedure IDs that reference the selected table
        procs_referencing_filter = set()
        if filter_obj and '.' in filter_obj and procedure_deps and (show_procedures or show_functions):
            for dep in procedure_deps:
                all_tables = set(dep.get('reads_from', [])) | set(dep.get('writes_to', []))
                for t in all_tables:
                    tid = t if '.' in t else f"{dep['procedure_schema']}.{t}" if dep.get('procedure_schema') else t
                    if tid == filter_obj:
                        procs_referencing_filter.add(dep['procedure_id'])
                        break

        if procedures and (show_procedures or show_functions):
            for proc in procedures:
                proc_schema = proc.get('schema')
                if not proc_schema:
                    proc_schema = default_schema if default_schema else None
                    if not proc_schema:
                        continue
                proc_name = proc.get('name', '')
                proc_id = f"{proc_schema}.{proc_name}"
                proc_type = proc.get('type', 'procedure')

                # Filter by schema or specific object/table
                if filter_obj:
                    if '.' not in filter_obj:
                        if proc_schema != filter_obj:
                            continue
                    else:
                        if filter_obj not in [proc_id, proc_name] and proc_id not in procs_referencing_filter:
                            continue
                
                # Check if this type should be shown
                if proc_type == 'procedure' and not show_procedures:
                    continue
                if proc_type == 'function' and not show_functions:
                    continue
                
                if proc_id not in node_ids:
                    nodes.append({
                        'id': proc_id,
                        'label': proc_name,
                        'type': proc_type,
                        'schema': proc_schema,
                        'title': f"{proc_type.capitalize()}: {proc_id}"
                    })
                    node_ids.add(proc_id)
        
        # Add procedure/function edges
        if procedure_deps and show_tables:
            for dep in procedure_deps:
                proc_id = dep['procedure_id']
                
                if proc_id not in node_ids:
                    continue
                
                reads_from = set(dep.get('reads_from', []))
                writes_to = set(dep.get('writes_to', []))
                
                normalized_reads = set()
                normalized_writes = set()
                
                for table_id in reads_from:
                    if '.' not in table_id:
                        table_id = f"{dep['procedure_schema']}.{table_id}"
                    if table_id in node_ids:
                        normalized_reads.add(table_id)
                
                for table_id in writes_to:
                    if '.' not in table_id:
                        table_id = f"{dep['procedure_schema']}.{table_id}"
                    if table_id in node_ids:
                        normalized_writes.add(table_id)
                
                all_tables_involved = normalized_reads | normalized_writes
                
                for table_id in all_tables_involved:
                    reads = table_id in normalized_reads
                    writes = table_id in normalized_writes
                    
                    if reads and writes:
                        edges.append({
                            'id': f"proc_read_{proc_id}_{table_id}",
                            'from': table_id,
                            'to': proc_id,
                            'title': f"{dep['procedure_type'].capitalize()} reads from {table_id}",
                            'label': 'reads from',
                            'type': 'procedure_dependency',
                            'dashed': True,
                            'color': '#9B59B6'
                        })
                        edges.append({
                            'id': f"proc_write_{proc_id}_{table_id}",
                            'from': proc_id,
                            'to': table_id,
                            'title': f"{dep['procedure_type'].capitalize()} writes to {table_id}",
                            'label': 'writes to',
                            'type': 'procedure_dependency',
                            'dashed': True,
                            'color': '#E74C3C'
                        })
                    elif reads:
                        edges.append({
                            'id': f"proc_read_{proc_id}_{table_id}",
                            'from': table_id,
                            'to': proc_id,
                            'title': f"{dep['procedure_type'].capitalize()} reads from {table_id}",
                            'label': 'reads from',
                            'type': 'procedure_dependency',
                            'dashed': True,
                            'color': '#9B59B6'
                        })
                    elif writes:
                        edges.append({
                            'id': f"proc_write_{proc_id}_{table_id}",
                            'from': proc_id,
                            'to': table_id,
                            'title': f"{dep['procedure_type'].capitalize()} writes to {table_id}",
                            'label': 'writes to',
                            'type': 'procedure_dependency',
                            'dashed': True,
                            'color': '#E74C3C'
                        })
        
        # Add triggers
        show_triggers = enabled_object_types is None or 'triggers' in enabled_object_types
        if triggers and show_triggers:
            for trigger in triggers:
                trigger_schema = trigger.get('schema')
                if not trigger_schema:
                    continue
                trigger_name = trigger.get('name', '')
                trigger_table = trigger.get('table_name', '')  # key is 'table_name', not 'table'
                trigger_id = f"{trigger_schema}.{trigger_name}"
                trigger_table_id = f"{trigger_schema}.{trigger_table}" if trigger_table else None
                
                # Filter by schema or specific object/table
                if filter_obj:
                    if '.' not in filter_obj:
                        if trigger_schema != filter_obj:
                            continue
                    else:
                        if filter_obj not in [trigger_id, trigger_name] and trigger_table_id != filter_obj:
                            continue
                
                if trigger_id not in node_ids:
                    nodes.append({
                        'id': trigger_id,
                        'label': trigger_name,
                        'type': 'trigger',
                        'schema': trigger_schema,
                        'title': f"Trigger: {trigger_id}\nTable: {trigger_table}"
                    })
                    node_ids.add(trigger_id)
                    
                    # Add edge from trigger to its table if table exists
                    if trigger_table and show_tables:
                        table_id = f"{trigger_schema}.{trigger_table}"
                        if table_id in node_ids:
                            edges.append({
                                'id': f"trigger_{trigger_id}_{table_id}",
                                'from': trigger_id,
                                'to': table_id,
                                'title': f"Trigger '{trigger_name}' on table '{trigger_table}'",
                                'type': 'trigger_dependency',
                                'dashed': True,
                                'color': '#E67E22'
                            })
        
        # Add sequences
        show_sequences = enabled_object_types is None or 'sequences' in enabled_object_types
        if sequences and show_sequences:
            for seq in sequences:
                seq_schema = seq.get('schema')
                if not seq_schema:
                    seq_schema = default_schema if default_schema else None
                    if not seq_schema:
                        continue
                seq_name = seq.get('name', '')
                seq_id = f"{seq_schema}.{seq_name}"
                
                # Filter by schema or specific object/table
                if filter_obj:
                    if '.' not in filter_obj:
                        if seq_schema != filter_obj:
                            continue
                    else:
                        if filter_obj not in [seq_id, seq_name]:
                            continue
                
                if seq_id not in node_ids:
                    nodes.append({
                        'id': seq_id,
                        'label': seq_name,
                        'type': 'sequence',
                        'schema': seq_schema,
                        'title': f"Sequence: {seq_id}"
                    })
                    node_ids.add(seq_id)
        
        # Add materialized views
        show_materialized_views = enabled_object_types is None or 'materialized_views' in enabled_object_types
        if materialized_views and show_materialized_views:
            for mv in materialized_views:
                mv_schema = mv.get('schema')
                if not mv_schema:
                    continue
                mv_name = mv.get('name', '')
                mv_id = f"{mv_schema}.{mv_name}"
                
                # Filter by schema or specific object/table
                if filter_obj:
                    if '.' not in filter_obj:
                        if mv_schema != filter_obj:
                            continue
                    else:
                        if filter_obj not in [mv_id, mv_name]:
                            continue
                
                if mv_id not in node_ids:
                    nodes.append({
                        'id': mv_id,
                        'label': mv_name,
                        'type': 'materialized_view',
                        'schema': mv_schema,
                        'title': f"Materialized View: {mv_id}"
                    })
                    node_ids.add(mv_id)
    
    elif level == 'column':
        # Column-level visualization
        if filter_obj:
            relevant_column_ids = set()
            
            if selected_column:
                schema_name = filter_obj.split('.')[0] if '.' in filter_obj else None
                table_name = filter_obj.split('.')[-1] if '.' in filter_obj else filter_obj
                if schema_name:
                    selected_col_id = f"{schema_name}.{table_name}.{selected_column}"
                else:
                    selected_col_id = f"{table_name}.{selected_column}"
                relevant_column_ids.add(selected_col_id)
            
            # Find all columns involved in FK relationships for this table
            for rel in relationships:
                source_table = f"{rel['source_schema']}.{rel['source_table']}"
                target_table = f"{rel['target_schema']}.{rel['target_table']}"

                if source_table == filter_obj or target_table == filter_obj:
                    source_col_id = f"{rel['source_schema']}.{rel['source_table']}.{rel['source_column']}"
                    target_col_id = f"{rel['target_schema']}.{rel['target_table']}.{rel['target_column']}"

                    # When a specific column is selected, only include FK relationships
                    # that directly involve the selected column
                    if selected_column:
                        if source_col_id == selected_col_id or target_col_id == selected_col_id:
                            relevant_column_ids.add(source_col_id)
                            relevant_column_ids.add(target_col_id)
                    else:
                        relevant_column_ids.add(source_col_id)
                        relevant_column_ids.add(target_col_id)
            
            # Add columns from column_dependencies if available
            if column_dependencies:
                for dep in column_dependencies.get('upstream', []):
                    if dep['type'] == 'foreign_key':
                        source_col_id = f"{dep['source_schema']}.{dep['source_table']}.{dep['source_column']}"
                        target_col_id = f"{dep['target_schema']}.{dep['target_table']}.{dep['target_column']}"
                        relevant_column_ids.add(source_col_id)
                        relevant_column_ids.add(target_col_id)
                
                for dep in column_dependencies.get('downstream', []):
                    if dep['type'] == 'foreign_key':
                        source_col_id = f"{dep['source_schema']}.{dep['source_table']}.{dep['source_column']}"
                        target_col_id = f"{dep['target_schema']}.{dep['target_table']}.{dep['target_column']}"
                        relevant_column_ids.add(source_col_id)
                        relevant_column_ids.add(target_col_id)
            
            # Only add all table columns when no specific column is selected
            if show_all_columns and filter_obj and not selected_column:
                table_columns = [c for c in columns if f"{c['schema']}.{c['table']}" == filter_obj]
                for col in table_columns:
                    col_id = f"{col['schema']}.{col['table']}.{col['column']}"
                    relevant_column_ids.add(col_id)
            
            # Add columns as nodes
            for col_id in relevant_column_ids:
                parts = col_id.split('.')
                if len(parts) >= 3:
                    col_schema = parts[0]
                    col_table = parts[1]
                    col_name = '.'.join(parts[2:])
                    
                    col_info = next((c for c in columns if f"{c['schema']}.{c['table']}.{c['column']}" == col_id), None)
                    
                    nodes.append({
                        'id': col_id,
                        'label': col_name,
                        'type': 'column',
                        'schema': col_schema,
                        'table': col_table,
                        'data_type': col_info['data_type'] if col_info else 'unknown',
                        'nullable': col_info['nullable'] if col_info else None,
                        'title': f"{col_id}\nType: {col_info['data_type'] if col_info else 'unknown'}\nNullable: {col_info['nullable'] if col_info else 'unknown'}"
                    })
                    node_ids.add(col_id)
            
            # Add FK relationships at column level
            for rel in relationships:
                source_table = f"{rel['source_schema']}.{rel['source_table']}"
                target_table = f"{rel['target_schema']}.{rel['target_table']}"
                
                if source_table == filter_obj or target_table == filter_obj:
                    source_col_id = f"{rel['source_schema']}.{rel['source_table']}.{rel['source_column']}"
                    target_col_id = f"{rel['target_schema']}.{rel['target_table']}.{rel['target_column']}"
                    
                    if source_col_id in relevant_column_ids and target_col_id in relevant_column_ids:
                        edges.append({
                            'id': f"fk_col_{rel['constraint_name']}",
                            'from': source_col_id,
                            'to': target_col_id,
                            'title': f"FK: {rel['constraint_name']}",
                            'label': 'FK',
                            'type': 'foreign_key'
                        })
    
    return {
        'nodes': nodes,
        'edges': edges,
        'metadata': {
            'level': level,
            'filter_obj': filter_obj,
            'node_count': len(nodes),
            'edge_count': len(edges),
            'table_count': sum(1 for n in nodes if n['type'] == 'table'),
            'view_count': sum(1 for n in nodes if n['type'] == 'view'),
            'column_count': sum(1 for n in nodes if n['type'] == 'column')
        }
    }

