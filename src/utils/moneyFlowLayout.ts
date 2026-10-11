import type { FlowItem, MoneyFlow } from './moneyFlow';

type Side = 'source' | 'destination';
/** `y` and `height` are the bar; `center` is where its label goes. */
export interface FlowNodeBox { item: FlowItem; side: Side; x: number; y: number; width: number; height: number; center: number }
/** A ribbon as a closed shape from `x0` to `x1`, as thick at one end as at the other. */
export interface FlowLink { item: FlowItem; side: Side; d: string; thickness: number; x0: number; x1: number }
export interface FlowLayout { width: number; height: number; hub: { x: number; y: number; width: number; height: number }; nodes: FlowNodeBox[]; links: FlowLink[] }
export interface FlowSize {
  width: number;
  height: number;
  /** Room kept free for labels outside the bars. */
  left?: number;
  right?: number;
  nodeWidth?: number;
  gap?: number;
  /** Vertical room each node keeps for its label, however small its amount. */
  minSlot?: number;
  /** Where the hub sits between both columns, from 0 to 1. */
  hubAt?: number;
}

const round = (value: number) => Math.round(value * 10) / 10;
const MIN_THICKNESS = 1.5;

/** Largest pixels-per-euro at which every node of a side still gets its slot. */
function sideScale(items: FlowItem[], available: number, slot: number): number {
  let pending = items;
  let remaining = available;
  for (;;) {
    const scale = remaining / pending.reduce((sum, item) => sum + item.amount, 0);
    const small = pending.filter(item => item.amount * scale < slot);
    if (!small.length) return scale;
    // Only when not even the minimum slots fit: the largest node fills an equal share.
    if (small.length === pending.length) return Math.min(...pending.map(item => remaining / pending.length / item.amount));
    remaining -= small.length * slot;
    pending = pending.filter(item => !small.includes(item));
  }
}

/**
 * Sources on the left, destinations on the right, joined through a hub. Every
 * ribbon keeps the same thickness along its way, at one scale for the whole
 * diagram, so widths can be compared across both sides.
 */
export function layoutMoneyFlow(flow: MoneyFlow, size: FlowSize): FlowLayout {
  const { width, height, left = 0, right = 0, nodeWidth = 10, gap = 6, minSlot = 34, hubAt = 0.36 } = size;
  const sides = ([['source', flow.sources], ['destination', flow.destinations]] as const).map(([side, items]) => {
    const spacing = items.length > 1 ? Math.min(gap, height / (items.length * 2)) : 0;
    const available = height - spacing * (items.length - 1);
    const slot = Math.min(minSlot, available / items.length);
    return { side, items, spacing, slot, scale: sideScale(items, available, slot) };
  });
  const scale = Math.min(...sides.map(side => side.scale));
  const hubHeight = flow.total * scale;
  const hub = { x: round(left + (width - left - right) * hubAt - nodeWidth / 2), y: round((height - hubHeight) / 2), width: nodeWidth, height: round(hubHeight) };
  const nodes: FlowNodeBox[] = [], links: FlowLink[] = [];
  for (const { side, items, spacing, slot } of sides) {
    const slots = items.map(item => Math.max(slot, item.amount * scale));
    let y = (height - slots.reduce((sum, value) => sum + value, 0) - spacing * (items.length - 1)) / 2;
    let hubY = (height - hubHeight) / 2;
    const x = side === 'source' ? left : width - right - nodeWidth;
    items.forEach((item, i) => {
      const thickness = Math.max(MIN_THICKNESS, item.amount * scale);
      const center = y + slots[i] / 2;
      const hubCenter = hubY + item.amount * scale / 2;
      nodes.push({ item, side, x: round(x), y: round(center - thickness / 2), width: nodeWidth, height: round(thickness), center: round(center) });
      const [x0, y0, x1, y1] = side === 'source' ? [x + nodeWidth, center, hub.x, hubCenter] : [hub.x + nodeWidth, hubCenter, x, center];
      const middle = round((x0 + x1) / 2), half = thickness / 2;
      const [a, b, c, e] = [y0 - half, y1 - half, y1 + half, y0 + half].map(round);
      links.push({ item, side, thickness: round(thickness), x0: round(x0), x1: round(x1),
        d: `M ${round(x0)} ${a} C ${middle} ${a} ${middle} ${b} ${round(x1)} ${b} L ${round(x1)} ${c} C ${middle} ${c} ${middle} ${e} ${round(x0)} ${e} Z` });
      y += slots[i] + spacing;
      hubY += item.amount * scale;
    });
  }
  return { width, height, hub, nodes, links };
}
