import { useState, useEffect, useRef } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, HelpCircle, Search, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import Layout from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useConnection } from '@/hooks/useConnection';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VisualizationCanvas } from '@/components/VisualizationCanvas';
import { ConnectionDropdown } from '@/components/ConnectionDropdown';

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? '';

const ALL_TABLES = '__ALL_TABLES__';

const Visualization = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { selectedConnectionId, selectConnection } = useConnection();
  const [selectedConnection, setSelectedConnection] = useState(selectedConnectionId || '');
  const [selectedSchema, setSelectedSchema] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [selectedColumn, setSelectedColumn] = useState('');
  const showAllColumns = true; // Always fetch all columns; initial view starts collapsed
  const [showOnlyConnectedTables, setShowOnlyConnectedTables] = useState(false);
  const [objectTypes, setObjectTypes] = useState<Record<string, boolean>>({
    tables: true,
    views: false,
    procedures: false,
    functions: false,
    triggers: false,
    sequences: false,
    materialized_views: false,
  });
  const [visualizationData, setVisualizationData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [visualizationError, setVisualizationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [canvasSearchQuery, setCanvasSearchQuery] = useState('');

  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [allTables, setAllTables] = useState<{ name: string; schema?: string }[]>([]);
  const [columnDependencies, setColumnDependencies] = useState<{
    upstream: any[];
    downstream: any[];
  } | null>(null);

  // Sync selected connection from shared context
  useEffect(() => {
    if (selectedConnectionId && !selectedConnection) {
      setSelectedConnection(selectedConnectionId);
    }
  }, [selectedConnectionId]);

  // When user changes connection in visualization, also update shared context
  const handleVisualizationConnectionChange = (connectionId: string) => {
    setSelectedConnection(connectionId);
    selectConnection(connectionId);
  };

  // Load schemas when connection changes
  useEffect(() => {
    if (!selectedConnection) {
      setSchemas([]);
      setSelectedSchema('');
      setAllTables([]);
      setVisualizationData(null);
      setVisualizationError(null);
      return;
    }

    // Use secure database-proxy instead of localStorage
    const loadSchemas = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: '/tables',
            connectionId: selectedConnection,
          }
        });

        if (error) {
          throw new Error(error.message || 'Failed to load tables');
        }

        const tablesArr = Array.isArray(data.tables) ? data.tables : [];
        setAllTables(tablesArr);
        const schemasSet = new Set<string>();
        tablesArr.forEach((t: any) => {
          const sc = t.schema || 'public';
          if (sc) schemasSet.add(sc);
        });
        const schemaList = Array.from(schemasSet).sort();
        setSchemas(schemaList);
        if (schemaList.length > 0 && !selectedSchema) {
          setSelectedSchema(schemaList[0]);
        }
      } catch (e: any) {
        console.error('Error loading tables:', e);
        setSchemas([]);
        setSelectedSchema('');
        setAllTables([]);
        setVisualizationData(null);
        setVisualizationError(e?.message || String(e));
        toast({ title: 'Error loading tables', description: e.message || String(e), variant: 'destructive' });
      }
    };

    loadSchemas();
  }, [selectedConnection]);

  // Load tables when schema changes (or when connection changes)
  useEffect(() => {
    if (!selectedConnection) {
      setTables([]);
      setSelectedTable('');
      setVisualizationData(null);
      setVisualizationError(null);
      return;
    }

    // If schema is selected, filter by schema; otherwise show all tables
    const tbls = selectedSchema
      ? allTables
          .filter((t) => (t.schema || 'public') === selectedSchema)
          .map((t) => t.name)
          .sort()
      : allTables.map((t) => t.name).sort();

    const sortedTables = [...tbls].sort();
    if (sortedTables.length > 0) {
      setTables(sortedTables);
    } else {
      setTables([]);
      setSelectedTable('');
    }
    setVisualizationData(null);
    setVisualizationError(null);
  }, [selectedSchema, allTables, selectedConnection]);

  // Load columns when table changes
  useEffect(() => {
    if (!selectedConnection || !selectedTable) {
      setColumns([]);
      setSelectedColumn('');
      setColumnDependencies(null);
      return;
    }

    const loadColumns = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: `/columns/${selectedTable}`,
          connectionId: selectedConnection,
        }
      });

        if (error) {
          throw new Error(error.message || 'Failed to load columns');
        }

        if (data?.columns) {
          const columnNames = data.columns.map((col: any) => col.column).sort();
          setColumns(columnNames);
        } else {
          setColumns([]);
        }
      } catch (e: any) {
        console.error('Error loading columns:', e);
        setColumns([]);
        toast({ title: 'Error loading columns', description: e.message || String(e), variant: 'destructive' });
      }
    };

    loadColumns();
  }, [selectedConnection, selectedSchema, selectedTable]);

  // Load column dependencies when column is selected
  useEffect(() => {
    if (!selectedConnection || !selectedTable || !selectedColumn) {
      setColumnDependencies(null);
      return;
    }

    const loadDependencies = async () => {
      try {
        // Use selectedSchema or default to 'public' for PostgreSQL
        const schema = selectedSchema || 'public';
        const { data, error } = await supabase.functions.invoke('database-proxy', {
          body: {
            endpoint: `/visualization/column-dependencies?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(selectedTable)}&column=${encodeURIComponent(selectedColumn)}`,
            connectionId: selectedConnection,
          }
        });

        if (error) {
          throw new Error(error.message || 'Failed to load dependencies');
        }

        if (data?.dependencies) {
          setColumnDependencies(data.dependencies);
        } else {
          setColumnDependencies(null);
        }
      } catch (e: any) {
        console.error('Error loading dependencies:', e);
        setColumnDependencies(null);
        toast({ title: 'Error loading dependencies', description: e.message || String(e), variant: 'destructive' });
      }
    };

    loadDependencies();
  }, [selectedConnection, selectedSchema || 'public', selectedTable, selectedColumn]);

  const handleGenerateVisualization = async () => {
    if (!selectedConnection) {
      toast({
        title: 'Select a connection',
        description: 'Choose a database connection before generating a visualization.',
        variant: 'destructive',
      });
      return;
    }

    // Determine visualization level automatically
    let visualizationLevel: 'schema' | 'table' | 'column';
    if (selectedColumn && selectedTable) {
      visualizationLevel = 'column';
    } else if (selectedTable) {
      visualizationLevel = 'table';
    } else {
      visualizationLevel = 'schema';
    }

    try {
      let filterObj: string | undefined;
      const schema = selectedSchema || 'public';
      
      if (visualizationLevel === 'schema') {
        // If schema is selected, filter by schema; otherwise show all
        filterObj = selectedSchema || undefined;
      } else if (visualizationLevel === 'table' && selectedTable) {
        filterObj = `${schema}.${selectedTable}`;
      } else if (visualizationLevel === 'column' && selectedTable && selectedColumn) {
        filterObj = `${schema}.${selectedTable}`;
      }

      const params = new URLSearchParams({ level: visualizationLevel });
      if (filterObj) {
        params.append('filter_obj', filterObj);
      }
      
      // If column is selected, also pass column info for dependency analysis
      if (selectedColumn && selectedTable) {
        params.append('column', selectedColumn);
        params.append('schema', schema);
      }
      
      // Add show_all_columns parameter
      if (showAllColumns) {
        params.append('show_all_columns', 'true');
      }

      // Add show_only_connected_tables parameter
      if (showOnlyConnectedTables) {
        params.append('show_only_connected_tables', 'true');
      }

      // Add object_types parameter (only include enabled types)
      const enabledTypes = Object.entries(objectTypes)
        .filter(([_, enabled]) => enabled)
        .map(([type, _]) => type);
      if (enabledTypes.length > 0) {
        params.append('object_types', enabledTypes.join(','));
      }

      setIsGenerating(true);
      setVisualizationError(null);
      setVisualizationData(null);
      setCollapsedNodes(new Set()); // Reset collapsed nodes

      // Use secure database-proxy to get JSON data
      const { data, error } = await supabase.functions.invoke('database-proxy', {
        body: {
          endpoint: `/visualization/data?${params.toString()}`,
          connectionId: selectedConnection,
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to load visualization');
      }

      // Extract nodes and edges from response
      // Handle both direct response and nested structure
      const nodes = data?.nodes || data?.data?.nodes || [];
      const edges = data?.edges || data?.data?.edges || [];
      
      // Allow empty edges but require at least one node
      if (nodes.length === 0) {
        throw new Error(`No nodes found in visualization data. Response keys: ${Object.keys(data || {}).join(', ')}`);
      }

      // Validate that nodes have required properties
      const validNodes = nodes.filter(node => node && node.id);
      if (validNodes.length === 0) {
        throw new Error(`No valid nodes found. Total nodes: ${nodes.length}, Sample: ${JSON.stringify(nodes[0] || {}).substring(0, 100)}`);
      }

      // Collapse only tables WITHOUT connections; tables with edges stay expanded
      const connectedIds = new Set<string>();
      edges.forEach((e: any) => { if (e?.from) connectedIds.add(e.from); if (e?.to) connectedIds.add(e.to); });
      const unconnectedIds = new Set<string>(nodes.filter((n: any) => n?.id && !connectedIds.has(n.id)).map((n: any) => n.id as string));
      setCollapsedNodes(unconnectedIds);

      setVisualizationData({ nodes, edges });
      toast({
        title: 'Visualization ready',
        description: filterObj
          ? `Focused view for ${filterObj}`
          : `Showing ${visualizationLevel}-level relationships`,
      });
    } catch (error: any) {
      const message = error?.message || 'Failed to load visualization.';
      setVisualizationData(null);
      setVisualizationError(message);
      toast({
        title: 'Visualization failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNodeCollapse = (nodeId: string, collapsed: boolean) => {
    setCollapsedNodes(prev => {
      const newSet = new Set(prev);
      if (collapsed) {
        newSet.add(nodeId);
      } else {
        newSet.delete(nodeId);
      }
      return newSet;
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('visualization.title')}</h1>
          <p className="text-muted-foreground">
            {t('visualization.description')}
          </p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 xl:grid-cols-6 gap-3 mb-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">{t('visualization.databaseConnection')}</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t('docs.tooltipVisConnection')}</TooltipContent>
                </Tooltip>
              </div>
              <ConnectionDropdown
                value={selectedConnection}
                onValueChange={(value) => {
                  handleVisualizationConnectionChange(value);
                  setSelectedSchema('');
                  setSelectedTable('');
                  setSelectedColumn('');
                }}
                placeholder={t('visualization.selectConnection')}
                noConnectionsText={t('visualization.noConnectionsSaved')}
                className="h-8 w-full min-w-0 max-w-none text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">{t('visualization.schema')} <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t('docs.tooltipVisSchema')}</TooltipContent>
                </Tooltip>
              </div>
              <Select value={selectedSchema || "_all"} onValueChange={(value) => {
                setSelectedSchema(value === "_all" ? "" : value);
                setSelectedTable('');
                setSelectedColumn('');
              }} disabled={schemas.length === 0}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={schemas.length === 0 ? t('visualization.noSchemasAvailable') : 'All schemas'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All schemas</SelectItem>
                  {schemas.map((schema) => (
                    <SelectItem key={schema} value={schema}>
                      {schema}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">{t('visualization.table')} <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t('docs.tooltipVisTable')}</TooltipContent>
                </Tooltip>
              </div>
              <Select value={selectedTable || "_all"} onValueChange={(value) => {
                setSelectedTable(value === "_all" ? "" : value);
                setSelectedColumn('');
              }} disabled={tables.length === 0}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      tables.length === 0
                        ? t('visualization.noTablesAvailable')
                        : 'All tables'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All tables</SelectItem>
                  {tables.map((table) => (
                    <SelectItem key={table} value={table}>
                      {table}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Label className="text-xs">Column <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t('docs.tooltipVisColumn')}</TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={selectedColumn}
                onValueChange={setSelectedColumn}
                disabled={!selectedTable || columns.length === 0}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      !selectedTable
                        ? 'Select table first'
                        : columns.length === 0
                          ? 'No columns available'
                          : 'Select column'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          <div className="flex items-end gap-3 mb-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="space-y-1.5">
                  <Label className="text-xs">Table Filter</Label>
                  <Select value={showOnlyConnectedTables ? "connected" : "all"} onValueChange={(value) => {
                    setShowOnlyConnectedTables(value === "connected");
                  }}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tables</SelectItem>
                      <SelectItem value="connected">Only connected tables</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TooltipTrigger>
              <TooltipContent>{t('docs.tooltipConnectedOnly')}</TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-8 text-xs justify-between">
                      Object Types
                      <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
              <PopoverContent className="w-[200px] p-4">
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">Show Object Types</Label>
                  {Object.entries(objectTypes).map(([type, enabled]) => (
                    <div key={type} className="flex items-center space-x-2">
                      <Checkbox
                        id={`type-${type}`}
                        checked={enabled}
                        onCheckedChange={(checked) => {
                          setObjectTypes(prev => ({ ...prev, [type]: checked === true }));
                        }}
                      />
                      <Label
                        htmlFor={`type-${type}`}
                        className="cursor-pointer text-sm capitalize"
                      >
                        {type.replace('_', ' ')}
                      </Label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
                </Popover>
              </TooltipTrigger>
              <TooltipContent>{t('docs.tooltipObjectTypes')}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleGenerateVisualization} disabled={isGenerating} className="h-8">
                  {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isGenerating ? t('visualization.generating') : t('visualization.generateVisualization')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('docs.tooltipGenerateVis')}</TooltipContent>
            </Tooltip>
          </div>

          {/* Column Dependencies Display */}
          {selectedColumn && columnDependencies && (
            <div className="mb-6">
              <div className="mb-4">
                <h3 className="text-lg font-semibold">Column Dependencies: {selectedSchema}.{selectedTable}.{selectedColumn}</h3>
              </div>
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Upstream Dependencies */}
                  <div>
                    <h4 className="font-semibold mb-3 text-sm">Upstream (What influences this column)</h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {columnDependencies.upstream.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No upstream dependencies found</p>
                      ) : (
                        columnDependencies.upstream.map((dep: any, idx: number) => (
                          <div key={idx} className="p-3 border rounded-lg text-sm">
                            <div className="font-medium">{dep.type}</div>
                            <div className="text-muted-foreground mt-1">
                              {dep.type === 'foreign_key' ? (
                                <span>{dep.source_schema}.{dep.source_table}.{dep.source_column} → {dep.target_schema}.{dep.target_table}.{dep.target_column}</span>
                              ) : (
                                <span>{dep.full_name || `${dep.schema}.${dep.name}`}</span>
                              )}
                            </div>
                            {dep.description && (
                              <div className="text-xs text-muted-foreground mt-1">{dep.description}</div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
          </div>

                  {/* Downstream Dependencies */}
                  <div>
                    <h4 className="font-semibold mb-3 text-sm">Downstream (What is influenced by this column)</h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {columnDependencies.downstream.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No downstream dependencies found</p>
                      ) : (
                        columnDependencies.downstream.map((dep: any, idx: number) => (
                          <div key={idx} className="p-3 border rounded-lg text-sm">
                            <div className="font-medium">{dep.type}</div>
                            <div className="text-muted-foreground mt-1">
                              {dep.type === 'foreign_key' ? (
                                <span>{dep.source_schema}.{dep.source_table}.{dep.source_column} → {dep.target_schema}.{dep.target_table}.{dep.target_column}</span>
                              ) : (
                                <span>{dep.full_name || `${dep.schema}.${dep.name}`}</span>
                              )}
                            </div>
                            {dep.description && (
                              <div className="text-xs text-muted-foreground mt-1">{dep.description}</div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
            <div className="p-6 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold mb-1">{t('visualization.visualizationPreview')}</h3>
                    <p className="text-sm text-muted-foreground break-words">
                      {selectedColumn
                        ? `Dependencies for ${selectedSchema || 'public'}.${selectedTable}.${selectedColumn}`
                        : selectedTable
                          ? `Table relationships for ${selectedSchema ? `${selectedSchema}.` : ''}${selectedTable}`
                          : (() => {
                              const enabledTypes = Object.entries(objectTypes)
                                .filter(([_, enabled]) => enabled)
                                .map(([type, _]) => type);
                              const typeLabels: Record<string, string> = {
                                tables: 'tables',
                                views: 'views',
                                procedures: 'procedures',
                                functions: 'functions',
                                triggers: 'triggers',
                                sequences: 'sequences',
                                materialized_views: 'materialized views',
                              };
                              const typeText = enabledTypes.length > 0 
                                ? enabledTypes.map(t => typeLabels[t] || t).join(', ')
                                : 'objects';
                              return selectedSchema
                                ? `All ${typeText} in schema: ${selectedSchema}`
                                : `All ${typeText} in database`;
                            })()}
                  </p>
                </div>
                  
                  {/* Legend */}
                  {visualizationData && !visualizationError && (
                    <div className="p-3 bg-muted/20 rounded-lg border border-border/50 text-[10px] w-1/2 flex-shrink-0" style={{fontFamily:'"IBM Plex Sans","SF Pro Text",system-ui,sans-serif'}}>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {/* Column indicators — dots match the canvas */}
                        <div className="flex items-center gap-2">
                          <svg width="8" height="8"><circle cx="4" cy="4" r="3.5" fill="#ED8936" opacity="0.9"/></svg>
                          <span className="text-muted-foreground">Primary Key</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg width="8" height="8"><circle cx="4" cy="4" r="3.5" fill="#4299E1" opacity="0.9"/></svg>
                          <span className="text-muted-foreground">Foreign Key</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg width="14" height="14"><circle cx="7" cy="7" r="3.5" fill="#ED8936" opacity="0.9"/><circle cx="7" cy="7" r="5.5" fill="none" stroke="#F6AD55" strokeWidth="0.8" strokeDasharray="2,1.5"/></svg>
                          <span className="text-muted-foreground">Composite PK</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg width="18" height="8"><circle cx="4" cy="4" r="3.5" fill="#ED8936" opacity="0.9"/><circle cx="12" cy="4" r="3.5" fill="#4299E1" opacity="0.9"/></svg>
                          <span className="text-muted-foreground">Composite PK + FK</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg width="8" height="8"><circle cx="4" cy="4" r="2.5" fill="#718096"/></svg>
                          <span className="text-muted-foreground">Non-Nullable</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <svg width="8" height="8"><circle cx="4" cy="4" r="2.5" fill="none" stroke="#4A5568" strokeWidth="1"/></svg>
                          <span className="text-muted-foreground">Nullable</span>
                        </div>
                        {/* Edge types */}
                        <div className="flex items-center gap-2">
                          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="#4A5568" strokeWidth="1.5" strokeDasharray="6,4"/></svg>
                          <span className="text-muted-foreground">FK Relation</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-0.5 rounded" style={{background:'#48BB78'}}></div>
                          <span className="text-muted-foreground">View Dep.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-0.5 rounded" style={{background:'#9F7AEA'}}></div>
                          <span className="text-muted-foreground">Proc/Func</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-0.5 rounded" style={{background:'#ED8936'}}></div>
                          <span className="text-muted-foreground">Trigger</span>
                        </div>
                        {/* Accent stripes */}
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-3 rounded-sm" style={{background:'#4299E1'}}></div>
                          <span className="text-muted-foreground">Table</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-3 rounded-sm" style={{background:'#48BB78'}}></div>
                          <span className="text-muted-foreground">View</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              {visualizationError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {visualizationError}
                </div>
              )}

              {!visualizationError && isGenerating && (
                <div className="aspect-video flex items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {t('visualization.buildingGraph')}
                </div>
              )}

              {!visualizationError && !isGenerating && !visualizationData && (
                <div className="aspect-video flex items-center justify-center text-center text-muted-foreground">
                  {t('visualization.chooseAndGenerate')}
                </div>
              )}

              {visualizationData && !visualizationError && (
                <div className="relative w-full border border-slate-700 rounded-md overflow-hidden" style={{ background: '#0C1220', height: 'calc(100vh - 200px)', minHeight: 500 }}>
                  {/* Change 8: Search input overlay + Change 12: Collapse/Expand All */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      zIndex: 40,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'rgba(30, 41, 59, 0.9)',
                        border: '1px solid rgba(51, 65, 85, 0.6)',
                        borderRadius: 6,
                        padding: '0 8px',
                      }}
                    >
                      <Search style={{ width: 14, height: 14, color: '#64748B', flexShrink: 0 }} />
                      <input
                        type="text"
                        value={canvasSearchQuery}
                        onChange={e => setCanvasSearchQuery(e.target.value)}
                        placeholder="Search tables..."
                        style={{
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: '#E2E8F0',
                          fontSize: '12px',
                          fontFamily: 'Inter, system-ui, sans-serif',
                          width: 140,
                          padding: '6px 0',
                        }}
                      />
                      {canvasSearchQuery && (
                        <button
                          onClick={() => setCanvasSearchQuery('')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#64748B',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <button
                      title="Collapse All"
                      onClick={() => {
                        const connIds = new Set<string>();
                        visualizationData.edges.forEach((e: any) => { if (e?.from) connIds.add(e.from); if (e?.to) connIds.add(e.to); });
                        setCollapsedNodes(new Set(visualizationData.nodes.filter(n => n?.id && !connIds.has(n.id)).map(n => n.id)));
                      }}
                      style={{
                        width: 30,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(30, 41, 59, 0.9)',
                        border: '1px solid rgba(51, 65, 85, 0.6)',
                        borderRadius: 6,
                        color: '#94A3B8',
                        cursor: 'pointer',
                      }}
                    >
                      <ChevronsDownUp style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      title="Expand All"
                      onClick={() => setCollapsedNodes(new Set())}
                      style={{
                        width: 30,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(30, 41, 59, 0.9)',
                        border: '1px solid rgba(51, 65, 85, 0.6)',
                        borderRadius: 6,
                        color: '#94A3B8',
                        cursor: 'pointer',
                      }}
                    >
                      <ChevronsUpDown style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  <VisualizationCanvas
                    nodes={visualizationData.nodes}
                    edges={visualizationData.edges}
                    collapsedNodes={collapsedNodes}
                    onNodeCollapse={handleNodeCollapse}
                    searchQuery={canvasSearchQuery}
                    onSearchClear={() => setCanvasSearchQuery('')}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Visualization;
