import { memo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Table as TableIcon,
  Eye,
  PlayCircle,
  Code,
  FileText,
  Zap,
  List,
  Layers,
} from 'lucide-react';

export interface SchemaNode {
  name: string;
  type: 'schema' | 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'sequence' | 'materialized_view' | 'group' | 'column';
  children?: SchemaNode[];
  count?: number;
  schema?: string;
  dataType?: string;
  nullable?: boolean;
  columnsLoaded?: boolean;
}

interface SchemaTreeProps {
  nodes: SchemaNode[];
  parentPath?: string;
  expandedNodes: Set<string>;
  onToggleNode: (path: string) => void;
  onLoadColumns: (node: SchemaNode, path: string) => Promise<void>;
  onNodeAction: (node: SchemaNode, action: string) => void;
  onContextMenu: (e: React.MouseEvent, node: SchemaNode) => void;
}

const getNodeIcon = (type: SchemaNode['type']) => {
  switch (type) {
    case 'table': return <TableIcon className="h-4 w-4" />;
    case 'view': return <Eye className="h-4 w-4" />;
    case 'materialized_view': return <Layers className="h-4 w-4" />;
    case 'procedure': return <PlayCircle className="h-4 w-4" />;
    case 'function': return <Code className="h-4 w-4" />;
    case 'trigger': return <Zap className="h-4 w-4" />;
    case 'sequence': return <List className="h-4 w-4" />;
    case 'column': return <FileText className="h-3 w-3" />;
    default: return <FileText className="h-4 w-4" />;
  }
};

const SchemaTreeNode = memo(({ 
  node, 
  nodePath, 
  isExpanded, 
  onToggleNode, 
  onLoadColumns, 
  onNodeAction,
  onContextMenu,
  expandedNodes,
}: {
  node: SchemaNode;
  nodePath: string;
  isExpanded: boolean;
  onToggleNode: (path: string) => void;
  onLoadColumns: (node: SchemaNode, path: string) => Promise<void>;
  onNodeAction: (node: SchemaNode, action: string) => void;
  onContextMenu: (e: React.MouseEvent, node: SchemaNode) => void;
  expandedNodes: Set<string>;
}) => {
  const hasChildren = node.children && node.children.length > 0;

  const handleExpandClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'group' || node.type === 'schema') {
      onToggleNode(nodePath);
    } else if (node.type === 'table' || node.type === 'view' || node.type === 'materialized_view') {
      if (!node.columnsLoaded) {
        await onLoadColumns(node, nodePath);
      } else {
        onToggleNode(nodePath);
      }
    }
  }, [node, nodePath, onToggleNode, onLoadColumns]);

  const handleNodeClick = useCallback(() => {
    if (node.type === 'column') {
      return;
    } else if (node.type === 'table' || node.type === 'view' || node.type === 'materialized_view') {
      onNodeAction(node, 'select_all');
    } else if (node.type === 'procedure') {
      onNodeAction(node, 'procedure_definition');
    }
  }, [node, onNodeAction]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (node.type !== 'column' && node.type !== 'group' && node.type !== 'schema') {
      e.preventDefault();
      onContextMenu(e, node);
    }
  }, [node, onContextMenu]);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1 rounded text-[10px]"
        onContextMenu={handleContextMenu}
      >
        {/* Expand/Collapse button for groups and schemas */}
        {(node.type === 'group' || node.type === 'schema') && (
          <button
            onClick={handleExpandClick}
            className="cursor-pointer flex-shrink-0 hover:bg-accent rounded p-0.5"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        
        {/* Expand button for tables/views to show columns - always visible */}
        {(node.type === 'table' || node.type === 'view' || node.type === 'materialized_view') && (
          <button
            onClick={handleExpandClick}
            className="cursor-pointer flex-shrink-0 p-0.5 rounded hover:bg-accent"
            title="Show columns"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
        
        {/* Icon for non-expandable items */}
        {node.type !== 'group' && node.type !== 'table' && node.type !== 'view' && node.type !== 'materialized_view' && (
          <span className="flex-shrink-0">{getNodeIcon(node.type)}</span>
        )}
        
        {/* Icon for tables/views */}
        {(node.type === 'table' || node.type === 'view' || node.type === 'materialized_view') && (
          <span className="flex-shrink-0">{getNodeIcon(node.type)}</span>
        )}
        
        {/* Main clickable area for tables/views - executes default action */}
        <div
          className="flex-1 cursor-pointer truncate"
          onClick={handleNodeClick}
        >
          <span>{node.name}</span>
          {node.type === 'column' && node.dataType && (
            <span className="text-[9px] text-muted-foreground ml-1">{node.dataType}</span>
          )}
          {node.count !== undefined && <span className="text-muted-foreground ml-1">({node.count})</span>}
        </div>
      </div>
      {isExpanded && hasChildren && (
        <div className="ml-4">
          <SchemaTree 
            nodes={node.children!} 
            parentPath={nodePath}
            expandedNodes={expandedNodes}
            onToggleNode={onToggleNode}
            onLoadColumns={onLoadColumns}
            onNodeAction={onNodeAction}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </div>
  );
});

SchemaTreeNode.displayName = 'SchemaTreeNode';

export const SchemaTree = memo(({ 
  nodes, 
  parentPath = '',
  expandedNodes,
  onToggleNode,
  onLoadColumns,
  onNodeAction,
  onContextMenu,
}: SchemaTreeProps) => {
  return (
    <div>
      {nodes.map(node => {
        const nodePath = parentPath ? `${parentPath}.${node.name}` : node.name;
        const isExpanded = expandedNodes.has(nodePath);

        return (
          <SchemaTreeNode
            key={nodePath}
            node={node}
            nodePath={nodePath}
            isExpanded={isExpanded}
            onToggleNode={onToggleNode}
            onLoadColumns={onLoadColumns}
            onNodeAction={onNodeAction}
            onContextMenu={onContextMenu}
            expandedNodes={expandedNodes}
          />
        );
      })}
    </div>
  );
});

SchemaTree.displayName = 'SchemaTree';
