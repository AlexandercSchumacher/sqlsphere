import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

/** Normalise nullable value that may arrive as boolean or as the string 'YES'/'NO'. */
const isNullable = (val: unknown): boolean =>
  val === true || String(val).toUpperCase() === 'YES';

interface Column {
  column: string;
  data_type: string;
  data_type_short?: string;
  nullable: boolean;
  is_primary_key?: boolean;
  is_foreign_key?: boolean;
  is_referenced_pk?: boolean;
}

interface Node {
  id: string;
  label: string;
  type: string;
  schema?: string;
  table?: string;
  columns?: Column[];
  column_count?: number;
  collapsed?: boolean;
  title?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  label?: string;
  title?: string;
  type: string;
  sourceColumn?: string;
  targetColumn?: string;
  dashed?: boolean;
  color?: string;
}

interface VisualizationCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: (node: Node) => void;
  onNodeCollapse?: (nodeId: string, collapsed: boolean) => void;
  collapsedNodes?: Set<string>;
  searchQuery?: string;
  onSearchClear?: () => void;
}

// Change 1: increased sizes
const ROW_H  = 28;
const HDR_H  = 44;
const NODE_W = 440;
const ACCENT_W = 4; // left accent stripe width

// Refined dark theme — warm charcoal with purposeful color accents
const D = {
  bg:      '#0C1220',   // canvas background (deeper)
  bgDot:   '#182032',   // grid dot colour
  card:    '#151D2E',   // card body (warmer charcoal)
  cardBd:  '#1E2A3E',   // card border (subtle)
  hdr:     '#1A2438',   // header background
  hdrHi:   '#212D42',   // header highlight (gradient top)
  hdrBd:   '#2A3650',   // header/body divider
  hdrText: '#F1F5F9',   // table name (brighter)
  colName: '#A0AEC0',   // column name text (warmer gray)
  colType: '#4A5568',   // data type badge text
  colTypeBg:'#1A2234',  // data type badge background
  colTypeBd:'#2D3748',  // data type badge border
  rowAlt:  '#121A2A',   // alternating row fill
  rowSep:  '#1E2A3E',   // row separator line
  pk:      '#F6AD55',   // warm amber — primary key
  pkText:  '#FBD38D',
  pkDot:   '#ED8936',   // PK dot fill
  fk:      '#63B3ED',   // sky blue — foreign key
  fkText:  '#90CDF4',
  fkDot:   '#4299E1',   // FK dot fill
  nlCol:   '#4A5568',   // nullable — muted
  nnCol:   '#718096',   // non-nullable — slightly brighter
  edgeFK:  '#4A5568',   // FK edge
  edgeView:'#48BB78',
  edgeProc:'#9F7AEA',
  edgeTrig:'#ED8936',
  btnFill: 'rgba(100,116,139,0.12)',
  btnBd:   'rgba(100,116,139,0.25)',
  btnText: '#718096',
  highlight: '#63B3ED', // hover highlight colour
  // Accent stripe colours by object type
  accentTable: '#4299E1',   // blue
  accentView:  '#48BB78',   // green
  accentProc:  '#9F7AEA',   // purple
  accentFunc:  '#9F7AEA',   // purple
  accentTrig:  '#ED8936',   // orange
  accentSeq:   '#718096',   // gray
  accentMatView:'#38B2AC',  // teal
} as const;

export const VisualizationCanvas = ({
  nodes,
  edges,
  onNodeClick,
  onNodeCollapse,
  collapsedNodes = new Set(),
  searchQuery,
  onSearchClear,
}: VisualizationCanvasProps) => {
  const svgRef       = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);
  const minimapRef   = useRef<HTMLCanvasElement>(null);
  const zoomRef      = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const autoFitRef   = useRef<(() => void) | null>(null);
  const reLayoutRef  = useRef<(() => void) | null>(null);
  const zoomScaleRef = useRef<number>(1);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    ro.observe(el);
    setDimensions({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const getNodeDims = (node: Node) => {
    const isCol = node.collapsed || collapsedNodes.has(node.id);
    if (isCol) return { w: NODE_W, h: HDR_H };
    if (node.columns?.length)
      return { w: NODE_W, h: HDR_H + node.columns.length * ROW_H + 4 };
    return { w: NODE_W, h: HDR_H + 30 };
  };

  const colYOff = (node: Node, colName?: string): number => {
    const isCol = node.collapsed || collapsedNodes.has(node.id);
    if (!colName || !node.columns || isCol) return HDR_H / 2;
    const lc = colName.toLowerCase();
    const i  = node.columns.findIndex(
      c => c.column === colName || c.column.toLowerCase() === lc,
    );
    return i === -1 ? HDR_H / 2 : HDR_H + i * ROW_H + ROW_H / 2;
  };

  // Tooltip helper
  const showTooltip = useCallback((html: string, x: number, y: number) => {
    const tip = tooltipRef.current;
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = `${x + 12}px`;
    tip.style.top = `${y + 12}px`;
  }, []);

  const hideTooltip = useCallback(() => {
    const tip = tooltipRef.current;
    if (tip) tip.style.display = 'none';
  }, []);

  // Zoom toolbar handlers
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(200).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(200).call(zoomRef.current.scaleBy, 0.77);
  }, []);

  const handleFitToScreen = useCallback(() => {
    autoFitRef.current?.();
  }, []);

  const handleReLayout = useCallback(() => {
    reLayoutRef.current?.();
  }, []);

  const handleExportSVG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    // Inline computed styles for standalone SVG
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema-diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportPNG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2x resolution for crisp export
      const canvas = document.createElement('canvas');
      canvas.width = svgEl.width.baseVal.value * scale;
      canvas.height = svgEl.height.baseVal.value * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const pngUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = 'schema-diagram.png';
      a.click();
    };
    img.src = url;
  }, []);

  /* -- Change 11: Keyboard shortcuts --------------------------------- */
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ev.key === '+' || ev.key === '=') handleZoomIn();
      else if (ev.key === '-') handleZoomOut();
      else if (ev.key === '0') handleFitToScreen();
      else if (ev.key === 'Escape') onSearchClear?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleZoomIn, handleZoomOut, handleFitToScreen, onSearchClear]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const valid      = nodes.filter(n => n?.id && n?.type);
    if (!valid.length) return;
    const ids        = new Set(valid.map(n => n.id));
    /* -- Change 13: Node lookup map for O(1) access ------------------- */
    const nodeMap    = new Map(valid.map(n => [n.id, n]));
    const validEdges = (edges || []).filter(
      e => e?.from && e?.to && ids.has(e.from) && ids.has(e.to) && e.from !== e.to,
    );
    const { width, height } = dimensions;

    /* -- DEFS ---------------------------------------------------- */
    const defs = svg.append('defs');

    // Dot-grid pattern
    const gp = defs.append('pattern')
      .attr('id', 'vs-grid').attr('width', 20).attr('height', 20)
      .attr('patternUnits', 'userSpaceOnUse');
    gp.append('rect').attr('width', 20).attr('height', 20).attr('fill', D.bg);
    [[0,0],[20,0],[0,20],[20,20]].forEach(([cx, cy]) =>
      gp.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 1).attr('fill', D.bgDot)
    );

    // Drop shadow
    const flt = defs.append('filter').attr('id', 'vs-shadow')
      .attr('x','-30%').attr('y','-30%').attr('width','160%').attr('height','160%');
    flt.append('feDropShadow')
      .attr('dx', 0).attr('dy', 4).attr('stdDeviation', 10)
      .attr('flood-color', '#00000070');

    // Arrow markers per edge colour
    const getEdgeColor = (e: Edge): string => {
      if (e.color) return e.color;
      const t = (e.type || '').toLowerCase();
      if (t.includes('foreign') || t === 'fk') return D.edgeFK;
      if (t === 'procedure' || t === 'function') return D.edgeProc;
      if (t === 'trigger') return D.edgeTrig;
      if (t === 'view')    return D.edgeView;
      return D.edgeFK;
    };

    [...new Set(validEdges.map(getEdgeColor))].forEach(c => {
      defs.append('marker')
        .attr('id', `mk${c.replace('#','')}`)
        .attr('viewBox', '0 -4 8 8').attr('refX', 7).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4Z').attr('fill', c);
    });

    /* -- BACKGROUND ----------------------------------------------- */
    svg.append('rect').attr('width','100%').attr('height','100%').attr('fill','url(#vs-grid)');

    /* -- LAYER GROUPS --------------------------------------------- */
    const main   = svg.append('g').attr('class', 'vs-main');
    const linksG = main.append('g').attr('class', 'vs-links');
    const nodesG = main.append('g').attr('class', 'vs-nodes');

    /* -- ZOOM / PAN ----------------------------------------------- */
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 6])
      .on('zoom', ev => {
        main.attr('transform', ev.transform.toString());
        zoomScaleRef.current = ev.transform.k;
        setZoomPercent(Math.round(ev.transform.k * 100));
        // Toggle edge label visibility based on zoom scale
        linksG.selectAll<SVGGElement, Edge>('g.ve-label')
          .attr('display', ev.transform.k > 0.5 ? null : 'none');

        /* -- Semantic zoom: keep table headers readable when zoomed out -- */
        const k = ev.transform.k;
        if (k < 0.7) {
          // Scale header text inversely (capped) so names stay readable
          const compensate = Math.min(0.7 / k, 3.0);
          nodesG.selectAll<SVGTextElement, Node>('text.vs-hdr-text')
            .each(function (d) {
              const dims = getNodeDims(d);
              const hw = dims.w / 2;
              const hh = dims.h / 2;
              d3.select(this)
                .attr('transform', `scale(${compensate})`)
                .attr('x', (-hw + ACCENT_W + 12) / compensate)
                .attr('y', (-hh + HDR_H / 2 + 5) / compensate);
            });
        } else {
          nodesG.selectAll<SVGTextElement, Node>('text.vs-hdr-text')
            .each(function (d) {
              const dims = getNodeDims(d);
              const hw = dims.w / 2;
              const hh = dims.h / 2;
              d3.select(this)
                .attr('transform', null)
                .attr('x', -hw + ACCENT_W + 12)
                .attr('y', -hh + HDR_H / 2 + 5);
            });
        }

        updateMinimap(ev.transform);
      });
    svg.call(zoomBehavior).on('dblclick.zoom', null);
    zoomRef.current = zoomBehavior;

    /* -- INITIAL POSITIONS (force-directed layout) ------------------- */
    const needsLayout = valid.some(n => n.x == null || isNaN(n.x as number));
    /* Canvas aspect ratio — spread nodes wider than tall to match screen shape */
    const aspect = width / Math.max(height, 1);
    if (needsLayout) {
      valid.forEach((n, i) => {
        if (n.x == null || isNaN(n.x as number)) {
          const angle = (i / valid.length) * 2 * Math.PI;
          n.x = Math.cos(angle) * 550 * Math.max(aspect, 1);
          n.y = Math.sin(angle) * 350;
        }
      });

      /* -- Find connected components so we can keep disconnected nodes close -- */
      const connectedIds = new Set<string>();
      validEdges.forEach(e => { connectedIds.add(e.from); connectedIds.add(e.to); });

      type SimLink = { source: string | Node; target: string | Node };
      const simLinks: SimLink[] = validEdges.map(e => ({ source: e.from, target: e.to }));

      const sim = d3.forceSimulation<Node>(valid)
        .force(
          'link',
          d3.forceLink<Node, SimLink>(simLinks)
            .id(d => d.id)
            .distance(420)
            .strength(1),
        )
        .force('charge', d3.forceManyBody<Node>().strength(-2800))
        .force(
          'collision',
          d3.forceCollide<Node>().radius(d => {
            const dims = getNodeDims(d);
            return Math.max(dims.w, dims.h) / 2 + 80;
          }),
        )
        /* Pull toward center — stronger Y pull compresses layout vertically,
           letting nodes spread more horizontally to match the wide canvas */
        .force('x', d3.forceX<Node>(0).strength(d => connectedIds.has(d.id) ? 0.01 : 0.2))
        .force('y', d3.forceY<Node>(0).strength(d => connectedIds.has(d.id) ? 0.12 : 0.6))
        .stop();

      for (let i = 0; i < 600; i++) {
        sim.tick();
        if (sim.alpha() < 0.01) break;
      }
    }

    /* -- EDGE OVERLAP PREVENTION ----------------------------------- */
    const edgePairGrp = new Map<string, Edge[]>();
    validEdges.forEach(e => {
      const key = [e.from, e.to].sort().join('\u2194');
      if (!edgePairGrp.has(key)) edgePairGrp.set(key, []);
      edgePairGrp.get(key)!.push(e);
    });
    const edgeMidOff = new Map<string, number>();
    edgePairGrp.forEach(edges => {
      if (edges.length > 1)
        edges.forEach((e, i) =>
          edgeMidOff.set(e.id, (i - (edges.length - 1) / 2) * 20)
        );
    });

    const srcColGrp = new Map<string, Edge[]>();
    validEdges.forEach(e => {
      const k = `${e.from}::${e.sourceColumn ?? ''}`;
      if (!srcColGrp.has(k)) srcColGrp.set(k, []);
      srcColGrp.get(k)!.push(e);
    });
    const edgeSrcYOff = new Map<string, number>();
    srcColGrp.forEach(edges => {
      if (edges.length > 1)
        edges.forEach((e, i) =>
          edgeSrcYOff.set(e.id, (i - (edges.length - 1) / 2) * 4)
        );
    });

    const tgtColGrp = new Map<string, Edge[]>();
    validEdges.forEach(e => {
      const k = `${e.to}::${e.targetColumn ?? ''}`;
      if (!tgtColGrp.has(k)) tgtColGrp.set(k, []);
      tgtColGrp.get(k)!.push(e);
    });
    const edgeTgtYOff = new Map<string, number>();
    tgtColGrp.forEach(edges => {
      if (edges.length > 1)
        edges.forEach((e, i) =>
          edgeTgtYOff.set(e.id, (i - (edges.length - 1) / 2) * 4)
        );
    });

    /* -- EDGE ROUTING HELPER ----------------------------------------- */
    const ROUTE_GAP = 30; // minimum clearance outside nodes
    const edgeRoute = (e: Edge) => {
      const s = nodeMap.get(e.from);
      const t = nodeMap.get(e.to);
      if (!s || !t || s.x == null || s.y == null || t.x == null || t.y == null) return null;
      const sd  = getNodeDims(s);
      const td  = getNodeDims(t);
      const sYO = edgeSrcYOff.get(e.id) ?? 0;
      const tYO = edgeTgtYOff.get(e.id) ?? 0;
      const mO  = edgeMidOff.get(e.id) ?? 0;
      const sy  = (s.y as number) - sd.h / 2 + colYOff(s, e.sourceColumn) + sYO;
      const ty  = (t.y as number) - td.h / 2 + colYOff(t, e.targetColumn) + tYO;

      const sRight = (s.x as number) + sd.w / 2;
      const sLeft  = (s.x as number) - sd.w / 2;
      const tRight = (t.x as number) + td.w / 2;
      const tLeft  = (t.x as number) - td.w / 2;

      let sx: number, ex: number, mid: number;

      if (tLeft - sRight >= ROUTE_GAP) {
        // Target clearly to the right — normal routing
        sx = sRight; ex = tLeft;
        mid = (sx + ex) / 2 + mO;
      } else if (sLeft - tRight >= ROUTE_GAP) {
        // Target clearly to the left — normal routing
        sx = sLeft; ex = tRight;
        mid = (sx + ex) / 2 + mO;
      } else {
        // Nodes overlap horizontally — route around the outside
        const spaceRight = Math.max(sRight, tRight);
        const spaceLeft  = Math.min(sLeft, tLeft);
        // Pick the side that is "more natural" (further from average center)
        const routeRight = (s.x as number) + (t.x as number) >= 0;
        if (routeRight) {
          sx = sRight; ex = tRight;
          mid = spaceRight + ROUTE_GAP + Math.abs(mO);
        } else {
          sx = sLeft; ex = tLeft;
          mid = spaceLeft - ROUTE_GAP - Math.abs(mO);
        }
      }

      return { sx, sy, ex, ty, mid };
    };

    /* -- EDGE PATH (horizontal orthogonal routing) -------------------- */
    const mkPath = (e: Edge): string => {
      const r = edgeRoute(e);
      if (!r) return '';
      return `M${r.sx},${r.sy} H${r.mid} V${r.ty} H${r.ex}`;
    };

    /* -- DRAW EDGES ------------------------------------------------ */
    const isDashed = (e: Edge) => {
      const t = (e.type || '').toLowerCase();
      return e.dashed || t === 'fk' || t.includes('foreign');
    };

    const paths = linksG.selectAll<SVGPathElement, Edge>('path.ve')
      .data(validEdges).enter().append('path')
      .attr('class', 've').attr('fill', 'none')
      .attr('stroke', getEdgeColor).attr('stroke-width', 1.5)
      .attr('opacity', 0.75)
      .attr('stroke-dasharray', d => isDashed(d) ? '6,4' : 'none')
      .attr('marker-end', d => `url(#mk${getEdgeColor(d).replace('#','')})`)
      .attr('d', mkPath)
      .style('pointer-events', 'stroke')
      .style('cursor', 'pointer');

    // Source attachment dots
    const srcDots = linksG.selectAll<SVGCircleElement, Edge>('circle.vsd')
      .data(validEdges).enter().append('circle')
      .attr('class', 'vsd').attr('r', 3)
      .attr('fill', getEdgeColor).attr('stroke', D.card).attr('stroke-width', 1.5);

    const positionSrcDots = () => {
      srcDots
        .attr('cx', d => { const r = edgeRoute(d); return r ? r.sx : 0; })
        .attr('cy', d => { const r = edgeRoute(d); return r ? r.sy : 0; });
    };
    positionSrcDots();

    /* -- Change 10: Edge labels (column names on FK edges) ----------- */
    const edgeLabels = linksG.selectAll<SVGGElement, Edge>('g.ve-label')
      .data(validEdges.filter(e => e.sourceColumn && e.targetColumn))
      .enter().append('g')
      .attr('class', 've-label')
      .attr('display', zoomScaleRef.current > 0.5 ? null : 'none')
      .each(function (e) {
        const r = edgeRoute(e);
        if (!r) return;
        const midX = r.mid;
        const midY = (r.sy + r.ty) / 2;

        const g = d3.select(this);
        g.attr('transform', `translate(${midX},${midY})`);

        const labelText = `${e.sourceColumn} \u2192 ${e.targetColumn}`;
        // Background rect (will be sized after text renders)
        const bg = g.append('rect')
          .attr('rx', 3).attr('ry', 3)
          .attr('fill', 'rgba(15, 23, 42, 0.85)')
          .attr('stroke', 'rgba(51, 65, 85, 0.4)')
          .attr('stroke-width', 0.5);
        const txt = g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .style('font-size', '8px')
          .style('font-family', '"JetBrains Mono","Fira Mono",ui-monospace,monospace')
          .style('fill', '#475569')
          .style('pointer-events', 'none')
          .text(labelText);

        // Size background to text
        const bbox = (txt.node() as SVGTextElement).getBBox();
        bg.attr('x', -bbox.width / 2 - 3)
          .attr('y', -bbox.height / 2 - 1.5)
          .attr('width', bbox.width + 6)
          .attr('height', bbox.height + 3);
      });

    /* -- HOVER HELPERS -------------------------------------------- */
    // Build adjacency: nodeId -> set of edge ids connected to it
    const nodeEdgeMap = new Map<string, Set<string>>();
    validEdges.forEach(e => {
      if (!nodeEdgeMap.has(e.from)) nodeEdgeMap.set(e.from, new Set());
      if (!nodeEdgeMap.has(e.to))   nodeEdgeMap.set(e.to, new Set());
      nodeEdgeMap.get(e.from)!.add(e.id);
      nodeEdgeMap.get(e.to)!.add(e.id);
    });

    // Build edge -> connected node ids
    const edgeNodeMap = new Map<string, [string, string]>();
    validEdges.forEach(e => edgeNodeMap.set(e.id, [e.from, e.to]));

    const resetAllStyles = () => {
      paths.attr('opacity', 0.75).attr('stroke-width', 1.5);
      nodeGs.select('rect').filter(function() {
        return d3.select(this).attr('filter') === 'url(#vs-shadow)';
      }).attr('stroke', D.cardBd).attr('stroke-width', 1);
      srcDots.attr('opacity', 1);
      hideTooltip();
    };

    /* -- DRAG (only the dragged node moves) ----------------------- */
    let wasDragged = false;
    const drag = d3.drag<SVGGElement, Node>()
      .on('start', function (_ev, d) {
        wasDragged = false;
        d.fx = d.x; d.fy = d.y;
        d3.select(this).raise().style('cursor', 'grabbing');
      })
      .on('drag', function (ev, d) {
        wasDragged = true;
        d.x = ev.x; d.y = ev.y; d.fx = ev.x; d.fy = ev.y;
        d3.select(this).attr('transform', `translate(${ev.x},${ev.y})`);
        paths.attr('d', mkPath);
        positionSrcDots();
        // Update edge labels on drag
        linksG.selectAll<SVGGElement, Edge>('g.ve-label')
          .each(function (e) {
            const r = edgeRoute(e);
            if (!r) return;
            d3.select(this).attr('transform', `translate(${r.mid},${(r.sy + r.ty) / 2})`);
          });
      })
      .on('end', function (_ev, d) {
        d.fx = d.x; d.fy = d.y;
        d3.select(this).style('cursor', 'grab');
      });

    /* -- DRAW NODES ------------------------------------------------ */
    const nodeGs = nodesG.selectAll<SVGGElement, Node>('g.vsn')
      .data(valid, d => d.id).enter().append('g')
      .attr('class', 'vsn')
      .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .style('cursor', 'grab')
      .call(drag)
      .on('click', (_, d) => { if (!wasDragged) onNodeClick?.(d); });

    // Helper: draw a key icon (PK indicator)
    const drawKey = (
      g: d3.Selection<SVGGElement, Node, SVGGElement, unknown>,
      cx: number, cy: number, color: string,
    ) => {
      g.append('circle')
        .attr('cx', cx - 3.5).attr('cy', cy)
        .attr('r', 3.5).attr('fill', 'none')
        .attr('stroke', color).attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
      g.append('line')
        .attr('x1', cx).attr('y1', cy)
        .attr('x2', cx + 5.5).attr('y2', cy)
        .attr('stroke', color).attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
      g.append('line')
        .attr('x1', cx + 3.5).attr('y1', cy)
        .attr('x2', cx + 3.5).attr('y2', cy + 2.5)
        .attr('stroke', color).attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
      g.append('line')
        .attr('x1', cx + 5.5).attr('y1', cy)
        .attr('x2', cx + 5.5).attr('y2', cy + 2.5)
        .attr('stroke', color).attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
    };

    // Helper: draw a diamond (nullable indicator)
    const drawDiamond = (
      g: d3.Selection<SVGGElement, Node, SVGGElement, unknown>,
      cx: number, cy: number, color: string, filled: boolean,
    ) => {
      const s = 4;
      g.append('path')
        .attr('d', `M${cx},${cy-s} L${cx+s},${cy} L${cx},${cy+s} L${cx-s},${cy} Z`)
        .attr('fill', filled ? color : 'none')
        .attr('stroke', color)
        .attr('stroke-width', filled ? 0 : 1.3)
        .style('pointer-events', 'none');
    };

    // Helper: draw table grid icon
    const drawTableIcon = (
      g: d3.Selection<SVGGElement, Node, SVGGElement, unknown>,
      x: number, y: number,
    ) => {
      const s = 3, gap = 1.5;
      [[0,0],[s+gap,0],[0,s+gap],[s+gap,s+gap]].forEach(([dx, dy]) => {
        g.append('rect')
          .attr('x', x + dx).attr('y', y + dy)
          .attr('width', s).attr('height', s).attr('rx', 0.5)
          .attr('fill', '#475569').style('pointer-events', 'none');
      });
    };

    // Accent colour by object type
    const accentColor = (type: string): string => {
      switch (type) {
        case 'table': return D.accentTable;
        case 'view': return D.accentView;
        case 'materialized_view': return D.accentMatView;
        case 'procedure': return D.accentProc;
        case 'function': return D.accentFunc;
        case 'trigger': return D.accentTrig;
        case 'sequence': return D.accentSeq;
        default: return D.accentTable;
      }
    };

    // Type badge labels
    const typeBadge = (type: string): string => {
      switch (type) {
        case 'table': return 'TABLE';
        case 'view': return 'VIEW';
        case 'materialized_view': return 'MAT VIEW';
        case 'procedure': return 'PROC';
        case 'function': return 'FUNC';
        case 'trigger': return 'TRIGGER';
        case 'sequence': return 'SEQ';
        default: return type.toUpperCase();
      }
    };

    nodeGs.each(function (d) {
      const g   = d3.select(this) as d3.Selection<SVGGElement, Node, SVGGElement, unknown>;
      const { w, h } = getNodeDims(d);
      const isCollapsed = d.collapsed || collapsedNodes.has(d.id);
      const hw = w / 2;
      const hh = h / 2;
      const accent = accentColor(d.type);

      // -- Card body with clip path for accent stripe --
      const clipId = `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
      defs.append('clipPath').attr('id', clipId)
        .append('rect').attr('x', -hw).attr('y', -hh)
        .attr('width', w).attr('height', h).attr('rx', 8);

      // Card background
      g.append('rect')
        .attr('x', -hw).attr('y', -hh)
        .attr('width', w).attr('height', h)
        .attr('rx', 8)
        .attr('fill', D.card).attr('stroke', D.cardBd).attr('stroke-width', 1)
        .attr('filter', 'url(#vs-shadow)');

      // -- Left accent stripe --
      g.append('rect')
        .attr('x', -hw).attr('y', -hh)
        .attr('width', ACCENT_W).attr('height', h)
        .attr('fill', accent)
        .attr('clip-path', `url(#${clipId})`)
        .style('pointer-events', 'none');

      // -- Header background with subtle gradient feel --
      g.append('rect')
        .attr('x', -hw + ACCENT_W).attr('y', -hh)
        .attr('width', w - ACCENT_W).attr('height', HDR_H)
        .attr('fill', D.hdrHi)
        .attr('clip-path', `url(#${clipId})`);
      // Lower half of header — slightly darker for gradient effect
      g.append('rect')
        .attr('x', -hw + ACCENT_W).attr('y', -hh + HDR_H * 0.5)
        .attr('width', w - ACCENT_W).attr('height', HDR_H * 0.5)
        .attr('fill', D.hdr)
        .attr('clip-path', `url(#${clipId})`);

      // -- Header/body divider --
      if (!isCollapsed) {
        g.append('line')
          .attr('x1', -hw + ACCENT_W).attr('x2', hw)
          .attr('y1', -hh + HDR_H).attr('y2', -hh + HDR_H)
          .attr('stroke', D.hdrBd).attr('stroke-width', 1);
      }

      // -- Type badge (small pill in header) --
      const badge = typeBadge(d.type);
      const badgeW = badge.length * 5.5 + 10;
      g.append('rect')
        .attr('x', -hw + ACCENT_W + 10).attr('y', -hh + 7)
        .attr('width', badgeW).attr('height', 14)
        .attr('rx', 3)
        .attr('fill', accent).attr('opacity', 0.15)
        .style('pointer-events', 'none');
      g.append('text')
        .attr('x', -hw + ACCENT_W + 10 + badgeW / 2).attr('y', -hh + 14)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .style('font-size', '8px').style('font-weight', '700')
        .style('font-family', '"JetBrains Mono","Fira Mono",ui-monospace,monospace')
        .style('fill', accent).style('letter-spacing', '0.5px')
        .style('pointer-events', 'none')
        .text(badge);

      // -- Table / object name --
      const labelX   = -hw + ACCENT_W + 12;
      const maxChars = 38;
      const labelText = d.label.length > maxChars
        ? d.label.slice(0, maxChars - 2) + '\u2026'
        : d.label;

      // Invisible wider rect for header hover / tooltip
      g.append('rect')
        .attr('class', 'vs-hdr-hover')
        .attr('x', -hw).attr('y', -hh)
        .attr('width', w).attr('height', HDR_H)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer')
        .on('mouseenter', (ev) => {
          const typeName = d.type === 'materialized_view' ? 'materialized view' : d.type;
          showTooltip(
            `<b>${d.label}</b><br/><span style="color:#A0AEC0">${typeName}</span>`,
            ev.offsetX, ev.offsetY,
          );
        })
        .on('mousemove', (ev) => {
          const tip = tooltipRef.current;
          if (tip && tip.style.display !== 'none') {
            tip.style.left = `${ev.offsetX + 12}px`;
            tip.style.top = `${ev.offsetY + 12}px`;
          }
        })
        .on('mouseleave', hideTooltip);

      g.append('text')
        .attr('class', 'vs-hdr-text')
        .attr('x', labelX).attr('y', -hh + HDR_H / 2 + 5)
        .attr('dominant-baseline', 'middle')
        .style('font-size', '13px').style('font-weight', '600')
        .style('font-family', '"IBM Plex Sans","SF Pro Display",system-ui,sans-serif')
        .style('fill', D.hdrText).style('pointer-events', 'none')
        .style('letter-spacing', '0.2px')
        .text(labelText);

      // -- Column count badge --
      const cnt = d.column_count ?? d.columns?.length ?? 0;
      const hasCols = !!(d.columns?.length);
      if (cnt > 0) {
        const cntStr = `${cnt}`;
        const cntW = cntStr.length * 6 + 10;
        g.append('rect')
          .attr('x', hw - (hasCols ? 32 : 12) - cntW).attr('y', -hh + HDR_H / 2 + 5 - 8)
          .attr('width', cntW).attr('height', 16)
          .attr('rx', 8)
          .attr('fill', 'rgba(74,85,104,0.2)')
          .style('pointer-events', 'none');
        g.append('text')
          .attr('x', hw - (hasCols ? 32 : 12) - cntW / 2)
          .attr('y', -hh + HDR_H / 2 + 5)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .style('font-size', '9px').style('fill', '#718096')
          .style('font-family', '"JetBrains Mono","Fira Mono",ui-monospace,monospace')
          .style('pointer-events', 'none').text(cntStr);
      }

      // -- Expand/collapse toggle --
      if (hasCols) {
        const btn = g.append('g').style('cursor', 'pointer').on('click', ev => {
          ev.stopPropagation();
          onNodeCollapse?.(d.id, !isCollapsed);
        });
        btn.append('rect')
          .attr('x', hw - 22).attr('y', -hh + HDR_H / 2 + 5 - 9)
          .attr('width', 18).attr('height', 18)
          .attr('rx', 4)
          .attr('fill', D.btnFill).attr('stroke', D.btnBd).attr('stroke-width', 0.5);
        btn.append('text')
          .attr('x', hw - 13).attr('y', -hh + HDR_H / 2 + 5)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .style('font-size', '12px').style('fill', D.btnText)
          .style('font-weight', '500')
          .style('pointer-events', 'none')
          .text(isCollapsed ? '+' : '\u2212');
      }

      // -- Column rows --
      if (!isCollapsed && d.columns) {
        const pkCount = d.columns.filter(c => c.is_primary_key).length;

        d.columns.forEach((col, i) => {
          const rowTop      = -hh + HDR_H + i * ROW_H;
          const midY        = rowTop + ROW_H / 2;
          const isPK        = !!col.is_primary_key;
          const isFK        = !!col.is_foreign_key;
          const isComposite = isPK && pkCount > 1;
          const showBoth    = isComposite && isFK;

          // Alternating row background
          if (i % 2 === 1) {
            g.append('rect')
              .attr('x', -hw + ACCENT_W).attr('y', rowTop)
              .attr('width', w - ACCENT_W - 1).attr('height', ROW_H)
              .attr('fill', D.rowAlt)
              .attr('clip-path', `url(#${clipId})`);
          }

          // Row separator — subtle dashed line
          if (i > 0) {
            g.append('line')
              .attr('x1', -hw + ACCENT_W + 8).attr('x2', hw - 8)
              .attr('y1', rowTop).attr('y2', rowTop)
              .attr('stroke', D.rowSep).attr('stroke-width', 0.5)
              .attr('stroke-dasharray', '2,3');
          }

          // -- Column type indicators (clean dot system) --
          const DOT_CX = -hw + ACCENT_W + 14;

          if (showBoth) {
            // Composite PK + FK: two dots side by side
            g.append('circle')
              .attr('cx', DOT_CX - 3).attr('cy', midY)
              .attr('r', 3.5).attr('fill', D.pkDot).attr('opacity', 0.9)
              .style('pointer-events', 'none');
            g.append('circle')
              .attr('cx', DOT_CX + 5).attr('cy', midY)
              .attr('r', 3.5).attr('fill', D.fkDot).attr('opacity', 0.9)
              .style('pointer-events', 'none');
            // Small chain link indicator for composite
            g.append('circle')
              .attr('cx', DOT_CX - 3).attr('cy', midY)
              .attr('r', 3.5).attr('fill', 'none')
              .attr('stroke', D.pk).attr('stroke-width', 1)
              .attr('stroke-dasharray', '2,1.5')
              .style('pointer-events', 'none');
          } else if (isComposite) {
            // Composite PK: dot with dashed ring
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 3.5).attr('fill', D.pkDot).attr('opacity', 0.9)
              .style('pointer-events', 'none');
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 5.5).attr('fill', 'none')
              .attr('stroke', D.pk).attr('stroke-width', 0.8)
              .attr('stroke-dasharray', '2,1.5')
              .style('pointer-events', 'none');
          } else if (isFK) {
            // FK: blue dot
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 3.5).attr('fill', D.fkDot).attr('opacity', 0.9)
              .style('pointer-events', 'none');
          } else if (isPK) {
            // PK: amber dot
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 3.5).attr('fill', D.pkDot).attr('opacity', 0.9)
              .style('pointer-events', 'none');
          } else if (!isNullable(col.nullable)) {
            // Non-nullable: filled small circle
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 2.5).attr('fill', D.nnCol)
              .style('pointer-events', 'none');
          } else {
            // Nullable: outline small circle
            g.append('circle')
              .attr('cx', DOT_CX).attr('cy', midY)
              .attr('r', 2.5).attr('fill', 'none')
              .attr('stroke', D.nlCol).attr('stroke-width', 1)
              .style('pointer-events', 'none');
          }

          // -- Column name --
          const nameX      = showBoth ? -hw + ACCENT_W + 28 : -hw + ACCENT_W + 26;
          const maxCharsN  = showBoth ? 26 : 32;
          const nameColor  = isFK ? D.fkText : isPK ? D.pkText : D.colName;
          const cLabel = col.column.length > maxCharsN
            ? col.column.slice(0, maxCharsN - 2) + '\u2026'
            : col.column;
          g.append('text')
            .attr('x', nameX).attr('y', midY)
            .attr('dominant-baseline', 'middle')
            .style('font-size', '11.5px')
            .style('font-family', '"IBM Plex Sans","SF Pro Text",system-ui,sans-serif')
            .style('fill', nameColor)
            .style('font-weight', isFK || isPK ? '500' : '400')
            .style('pointer-events', 'none')
            .text(cLabel);

          // -- Data type (pill badge) --
          const fullDtype = col.data_type_short || col.data_type || '';
          const dtype = fullDtype.toLowerCase().slice(0, 18);
          if (dtype) {
            const dtypeW = dtype.length * 5.8 + 10;
            g.append('rect')
              .attr('x', hw - 10 - dtypeW).attr('y', midY - 8)
              .attr('width', dtypeW).attr('height', 16)
              .attr('rx', 4)
              .attr('fill', D.colTypeBg).attr('stroke', D.colTypeBd).attr('stroke-width', 0.5)
              .style('pointer-events', 'none');
            g.append('text')
              .attr('x', hw - 10 - dtypeW / 2).attr('y', midY)
              .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
              .style('font-size', '9.5px')
              .style('font-family', '"JetBrains Mono","Fira Mono",ui-monospace,monospace')
              .style('fill', D.colType)
              .style('pointer-events', 'none')
              .text(dtype);
          }

          // Invisible hover rect per column row for tooltip
          g.append('rect')
            .attr('class', 'vs-col-hover')
            .attr('x', -hw + 1).attr('y', rowTop)
            .attr('width', w - 2).attr('height', ROW_H)
            .attr('fill', 'transparent')
            .style('cursor', 'default')
            .on('mouseenter', (ev) => {
              const fullType = col.data_type_short || col.data_type || '';
              showTooltip(
                `<b>${col.column}</b> &mdash; <span style="color:#A0AEC0">${fullType}</span>` +
                (isPK ? '<br/><span style="color:#FBD38D">Primary Key</span>' : '') +
                (isFK ? '<br/><span style="color:#90CDF4">Foreign Key</span>' : '') +
                (isNullable(col.nullable) ? '<br/><span style="color:#718096">Nullable</span>' : ''),
                ev.offsetX, ev.offsetY,
              );
            })
            .on('mousemove', (ev) => {
              const tip = tooltipRef.current;
              if (tip && tip.style.display !== 'none') {
                tip.style.left = `${ev.offsetX + 12}px`;
                tip.style.top = `${ev.offsetY + 12}px`;
              }
            })
            .on('mouseleave', hideTooltip);
        });
      } else if (!isCollapsed && !d.columns?.length && d.title) {
        g.append('text')
          .attr('x', 0).attr('y', -hh + HDR_H + 15)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
          .style('font-size', '10px').style('fill', D.colName)
          .style('pointer-events', 'none').text(d.title);
      }
    });

    /* -- Change 2: Node hover feedback ----------------------------- */
    nodeGs
      .on('mouseenter', function (_, d) {
        const el = d3.select(this);
        el.raise();
        // Highlight this node's border
        el.select('rect').filter(function() {
          return d3.select(this).attr('filter') === 'url(#vs-shadow)';
        }).attr('stroke', D.highlight).attr('stroke-width', 2);

        // Get connected edge ids
        const connEdges = nodeEdgeMap.get(d.id) ?? new Set();
        // Highlight connected edges, dim others
        paths.attr('opacity', e => connEdges.has(e.id) ? 1.0 : 0.15)
             .attr('stroke-width', e => connEdges.has(e.id) ? 2.5 : 1.5);
        srcDots.attr('opacity', e => connEdges.has(e.id) ? 1.0 : 0.15);

        // Highlight connected nodes
        const connNodeIds = new Set<string>();
        connEdges.forEach(eid => {
          const pair = edgeNodeMap.get(eid);
          if (pair) { connNodeIds.add(pair[0]); connNodeIds.add(pair[1]); }
        });
        nodeGs.each(function(nd) {
          if (nd.id !== d.id && connNodeIds.has(nd.id)) {
            d3.select(this).select('rect').filter(function() {
              return d3.select(this).attr('filter') === 'url(#vs-shadow)';
            }).attr('stroke', D.highlight).attr('stroke-width', 2);
          }
        });
      })
      .on('mouseleave', resetAllStyles);

    /* -- Change 2: Edge hover feedback ----------------------------- */
    paths
      .on('mouseenter', function (ev, e) {
        d3.select(this).attr('opacity', 1.0).attr('stroke-width', 2.5);
        // Dim other edges
        paths.filter(d => d.id !== e.id).attr('opacity', 0.15);
        srcDots.attr('opacity', d => d.id === e.id ? 1.0 : 0.15);
        // Highlight connected nodes
        const pair = edgeNodeMap.get(e.id);
        if (pair) {
          nodeGs.each(function(nd) {
            if (nd.id === pair[0] || nd.id === pair[1]) {
              d3.select(this).select('rect').filter(function() {
                return d3.select(this).attr('filter') === 'url(#vs-shadow)';
              }).attr('stroke', D.highlight).attr('stroke-width', 2);
            }
          });
        }
        // Change 3: Edge tooltip
        const srcLabel = e.sourceColumn ? `${nodeMap.get(e.from)?.label ?? e.from}.${e.sourceColumn}` : (nodeMap.get(e.from)?.label ?? e.from);
        const tgtLabel = e.targetColumn ? `${nodeMap.get(e.to)?.label ?? e.to}.${e.targetColumn}` : (nodeMap.get(e.to)?.label ?? e.to);
        showTooltip(
          `<b>${srcLabel}</b> &rarr; <b>${tgtLabel}</b>` +
          (e.label ? `<br/><span style="color:#94A3B8">${e.label}</span>` : ''),
          ev.offsetX, ev.offsetY,
        );
      })
      .on('mousemove', (ev) => {
        const tip = tooltipRef.current;
        if (tip && tip.style.display !== 'none') {
          tip.style.left = `${ev.offsetX + 12}px`;
          tip.style.top = `${ev.offsetY + 12}px`;
        }
      })
      .on('mouseleave', () => {
        resetAllStyles();
      });

    /* -- AUTO-FIT (Change 1: removed *0.9, max scale 1.4->2.0) ---- */
    const autoFit = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      valid.forEach(n => {
        if (n.x == null || n.y == null) return;
        const { w, h } = getNodeDims(n);
        x0 = Math.min(x0, (n.x as number) - w / 2);
        y0 = Math.min(y0, (n.y as number) - h / 2);
        x1 = Math.max(x1, (n.x as number) + w / 2);
        y1 = Math.max(y1, (n.y as number) + h / 2);
      });
      if (!isFinite(x0)) return;
      const pad = 60;
      const sc = Math.min(
        (width  - pad * 2) / Math.max(x1 - x0, 1),
        (height - pad * 2) / Math.max(y1 - y0, 1),
        2.0,
      );
      /* Let auto-fit show all tables; semantic zoom keeps headers readable */
      const finalSc = Math.max(sc, 0.08);
      const tx = width  / 2 - ((x0 + x1) / 2) * finalSc;
      const ty = height / 2 - ((y0 + y1) / 2) * finalSc;
      svg.transition().duration(400)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(finalSc));
    };
    autoFitRef.current = autoFit;

    /* -- Re-layout -------------------------------------------------- */
    const reLayout = () => {
      // Reset positions to aspect-ratio-aware elliptical layout
      valid.forEach((n, i) => {
        const angle = (i / valid.length) * 2 * Math.PI;
        n.x = Math.cos(angle) * 550 * Math.max(aspect, 1);
        n.y = Math.sin(angle) * 350;
        n.fx = null;
        n.fy = null;
      });

      const connIds = new Set<string>();
      validEdges.forEach(e => { connIds.add(e.from); connIds.add(e.to); });

      type SimLink = { source: string | Node; target: string | Node };
      const simLinks: SimLink[] = validEdges.map(e => ({ source: e.from, target: e.to }));

      const sim = d3.forceSimulation<Node>(valid)
        .force(
          'link',
          d3.forceLink<Node, SimLink>(simLinks)
            .id(d => d.id)
            .distance(420)
            .strength(1),
        )
        .force('charge', d3.forceManyBody<Node>().strength(-2800))
        .force(
          'collision',
          d3.forceCollide<Node>().radius(d => {
            const dims = getNodeDims(d);
            return Math.max(dims.w, dims.h) / 2 + 80;
          }),
        )
        .force('x', d3.forceX<Node>(0).strength(d => connIds.has(d.id) ? 0.01 : 0.2))
        .force('y', d3.forceY<Node>(0).strength(d => connIds.has(d.id) ? 0.12 : 0.6))
        .stop();

      for (let i = 0; i < 600; i++) {
        sim.tick();
        if (sim.alpha() < 0.01) break;
      }

      // Pin positions after layout
      valid.forEach(n => { n.fx = n.x; n.fy = n.y; });

      // Update node positions
      nodeGs.data(valid, d => d.id)
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

      // Update edges
      paths.attr('d', mkPath);
      positionSrcDots();

      // Update edge labels if they exist
      linksG.selectAll<SVGGElement, Edge>('g.ve-label')
        .each(function (e) {
          const r = edgeRoute(e);
          if (!r) return;
          d3.select(this).attr('transform', `translate(${r.mid},${(r.sy + r.ty) / 2})`);
        });

      // Re-fit and update minimap
      autoFit();
      updateMinimap(d3.zoomTransform(svgRef.current!));
    };
    reLayoutRef.current = reLayout;

    /* -- Change 5: Minimap ----------------------------------------- */
    const updateMinimap = (transform?: d3.ZoomTransform) => {
      const canvas = minimapRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const MW = canvas.width;
      const MH = canvas.height;
      ctx.clearRect(0, 0, MW, MH);

      // Compute world bounds
      let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
      valid.forEach(n => {
        if (n.x == null || n.y == null) return;
        const dims = getNodeDims(n);
        wx0 = Math.min(wx0, (n.x as number) - dims.w / 2);
        wy0 = Math.min(wy0, (n.y as number) - dims.h / 2);
        wx1 = Math.max(wx1, (n.x as number) + dims.w / 2);
        wy1 = Math.max(wy1, (n.y as number) + dims.h / 2);
      });
      if (!isFinite(wx0)) return;

      // Pad world bounds
      const padW = (wx1 - wx0) * 0.1 || 50;
      const padH = (wy1 - wy0) * 0.1 || 50;
      wx0 -= padW; wy0 -= padH; wx1 += padW; wy1 += padH;

      const worldW = wx1 - wx0;
      const worldH = wy1 - wy0;
      const mScale = Math.min(MW / worldW, MH / worldH);

      // Background
      ctx.fillStyle = 'rgba(12, 18, 32, 0.9)';
      ctx.fillRect(0, 0, MW, MH);

      // Draw node rectangles
      const headerColors: Record<string, string> = {
        table: D.accentTable,
        view: D.accentView,
        materialized_view: D.accentMatView,
        procedure: D.accentProc,
        function: D.accentFunc,
        trigger: D.accentTrig,
        sequence: D.accentSeq,
      };

      valid.forEach(n => {
        if (n.x == null || n.y == null) return;
        const dims = getNodeDims(n);
        const rx = ((n.x as number) - dims.w / 2 - wx0) * mScale;
        const ry = ((n.y as number) - dims.h / 2 - wy0) * mScale;
        const rw = dims.w * mScale;
        const rh = dims.h * mScale;
        ctx.fillStyle = headerColors[n.type] || '#334155';
        ctx.fillRect(rx, ry, Math.max(rw, 2), Math.max(rh, 2));
      });

      // Draw viewport rectangle
      if (transform) {
        const vx0 = (-transform.x) / transform.k;
        const vy0 = (-transform.y) / transform.k;
        const vw  = width / transform.k;
        const vh  = height / transform.k;
        const rx = (vx0 - wx0) * mScale;
        const ry = (vy0 - wy0) * mScale;
        const rw = vw * mScale;
        const rh = vh * mScale;
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = 'rgba(96, 165, 250, 0.08)';
        ctx.fillRect(rx, ry, rw, rh);
      }

      // Store world bounds and scale for click handler
      (canvas as any).__mmData = { wx0, wy0, worldW, worldH, mScale };
    };

    // Initial minimap draw
    updateMinimap(d3.zoomIdentity);

    // Minimap click-to-pan
    const canvas = minimapRef.current;
    const mmClickHandler = (ev: MouseEvent) => {
      const c = minimapRef.current;
      if (!c) return;
      const mmData = (c as any).__mmData;
      if (!mmData) return;
      const rect = c.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      // Convert minimap coords back to world coords
      const worldX = mx / mmData.mScale + mmData.wx0;
      const worldY = my / mmData.mScale + mmData.wy0;
      // Get current transform to preserve scale
      const currentTransform = d3.zoomTransform(svgRef.current!);
      const k = currentTransform.k;
      const tx = width / 2 - worldX * k;
      const ty = height / 2 - worldY * k;
      svg.transition().duration(300)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    };
    if (canvas) {
      canvas.addEventListener('click', mmClickHandler);
    }

    const tid = setTimeout(autoFit, 80);
    return () => {
      clearTimeout(tid);
      if (canvas) canvas.removeEventListener('click', mmClickHandler);
    };
  }, [nodes, edges, dimensions, collapsedNodes, onNodeClick, onNodeCollapse, showTooltip, hideTooltip]);

  /* -- Change 8: Search highlight effect ------------------------------ */
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchTotalCount, setSearchTotalCount] = useState(0);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const nodeGs = svg.selectAll<SVGGElement, Node>('g.vsn');
    const valid = nodes.filter(n => n?.id && n?.type);

    if (!searchQuery || !searchQuery.trim()) {
      // Reset all nodes to full opacity and default border
      nodeGs.attr('opacity', 1)
        .select('rect').filter(function() {
          return d3.select(this).attr('filter') === 'url(#vs-shadow)';
        })
        .attr('stroke', D.cardBd).attr('stroke-width', 1);
      setSearchMatchCount(0);
      setSearchTotalCount(valid.length);
      return;
    }

    const q = searchQuery.trim().toLowerCase();
    const matchIds = new Set<string>();
    let firstMatch: Node | null = null;

    nodeGs.each(function (d) {
      const isMatch = d.label.toLowerCase().includes(q);
      if (isMatch) {
        matchIds.add(d.id);
        if (!firstMatch) firstMatch = d;
      }
      d3.select(this).attr('opacity', isMatch ? 1 : 0.3);
      d3.select(this).select('rect').filter(function() {
        return d3.select(this).attr('filter') === 'url(#vs-shadow)';
      })
        .attr('stroke', isMatch ? '#F59E0B' : D.cardBd)
        .attr('stroke-width', isMatch ? 2.5 : 1);
    });

    setSearchMatchCount(matchIds.size);
    setSearchTotalCount(valid.length);

    // Auto-pan to first match
    if (firstMatch && zoomRef.current) {
      const n = firstMatch as Node;
      if (n.x != null && n.y != null) {
        const { width, height } = dimensions;
        const currentK = d3.zoomTransform(svgRef.current!).k;
        const tx = width / 2 - (n.x as number) * currentK;
        const ty = height / 2 - (n.y as number) * currentK;
        svg.transition().duration(400)
          .call(zoomRef.current!.transform, d3.zoomIdentity.translate(tx, ty).scale(currentK));
      }
    }
  }, [searchQuery, nodes, dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden relative" style={{ background: '#0C1220' }}>
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="block"
        style={{ userSelect: 'none' }}
      />

      {/* Change 8: Search match count */}
      {searchQuery && searchQuery.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 46,
            left: 12,
            background: 'rgba(30, 41, 59, 0.9)',
            color: searchMatchCount > 0 ? '#F59E0B' : '#94A3B8',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: '11px',
            fontFamily: 'Inter, system-ui, sans-serif',
            border: '1px solid rgba(51, 65, 85, 0.6)',
            zIndex: 40,
          }}
        >
          {searchMatchCount} of {searchTotalCount} tables
        </div>
      )}

      {/* Tooltip div */}
      <div
        ref={tooltipRef}
        style={{
          display: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          background: '#1A2438',
          color: '#F1F5F9',
          padding: '7px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          fontFamily: '"IBM Plex Sans","SF Pro Text",system-ui,sans-serif',
          lineHeight: '1.5',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(42,54,80,0.6)',
          border: 'none',
          pointerEvents: 'none',
          zIndex: 50,
          maxWidth: '320px',
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(8px)',
        }}
      />

      {/* Change 4: Zoom toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          zIndex: 40,
        }}
      >
        {[
          { label: '+', title: 'Zoom in', handler: handleZoomIn },
          { label: '\u2212', title: 'Zoom out', handler: handleZoomOut },
          { label: '\u2922', title: 'Fit to screen', handler: handleFitToScreen },
          { label: '\u21BB', title: 'Re-layout', handler: handleReLayout },
          { label: 'PNG', title: 'Export PNG', handler: handleExportPNG },
          { label: 'SVG', title: 'Export SVG', handler: handleExportSVG },
        ].map(({ label, title, handler }) => (
          <button
            key={title}
            title={title}
            onClick={handler}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(30, 41, 59, 0.85)',
              border: '1px solid rgba(51, 65, 85, 0.6)',
              borderRadius: 6,
              color: '#94A3B8',
              fontSize: label.length > 1 ? 9 : 18,
              fontWeight: 600,
              cursor: 'pointer',
              lineHeight: 1,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              (e.target as HTMLElement).style.background = 'rgba(51, 65, 85, 0.9)';
              (e.target as HTMLElement).style.color = '#E2E8F0';
            }}
            onMouseLeave={e => {
              (e.target as HTMLElement).style.background = 'rgba(30, 41, 59, 0.85)';
              (e.target as HTMLElement).style.color = '#94A3B8';
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Change 14: Zoom level indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 170,
          color: '#64748B',
          fontSize: '11px',
          fontFamily: '"JetBrains Mono","Fira Mono",ui-monospace,monospace',
          zIndex: 40,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {zoomPercent}%
      </div>

      {/* Change 5: Minimap */}
      <canvas
        ref={minimapRef}
        width={150}
        height={100}
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          borderRadius: 6,
          border: '1px solid rgba(51, 65, 85, 0.6)',
          cursor: 'crosshair',
          zIndex: 40,
        }}
      />
    </div>
  );
};
