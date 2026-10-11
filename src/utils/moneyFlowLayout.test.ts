import { describe, expect, it } from 'vitest';
import type { FlowItem, MoneyFlow } from './moneyFlow';
import { layoutMoneyFlow } from './moneyFlowLayout';

const item = (amount: number): FlowItem => ({ id: String(amount), label: 'Category', amount, percent: 0, color: null });
const flow: MoneyFlow = { total: 100, sources: [item(100)], destinations: [item(80), item(19), item(1)] };
const numbers = (d: string) => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);

describe('layoutMoneyFlow', () => {
  it('keeps every node inside the height, with room for its label', () => {
    const layout = layoutMoneyFlow(flow, { width: 500, height: 288 });
    for (const side of ['source', 'destination']) {
      const nodes = layout.nodes.filter(node => node.side === side);
      nodes.forEach((node, i) => {
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.y + node.height).toBeLessThanOrEqual(288);
        expect(node.center).toBeCloseTo(node.y + node.height / 2, 0);
        if (i) expect(node.center - nodes[i - 1].center).toBeGreaterThanOrEqual(34);
      });
    }
  });
  it('draws every amount at one scale, on both sides and through the hub', () => {
    const layout = layoutMoneyFlow(flow, { width: 500, height: 288 });
    const scale = layout.hub.height / flow.total;
    layout.nodes.forEach(node => expect(node.height).toBeCloseTo(Math.max(1.5, node.item.amount * scale), 0));
    layout.links.forEach((link, i) => expect(link.thickness).toBe(layout.nodes[i].height));
    expect(layout.nodes[0].height).toBeCloseTo(layout.hub.height, 0);
    expect(layout.nodes[0].center).toBe(144);
  });
  it('stacks ribbons on the hub without gaps and keeps their thickness', () => {
    const layout = layoutMoneyFlow(flow, { width: 500, height: 288 });
    for (const side of ['source', 'destination'] as const) {
      let cursor = layout.hub.y;
      layout.links.filter(link => link.side === side).forEach(link => {
        const coords = numbers(link.d);
        const [top, bottom] = side === 'source' ? [coords[7], coords[9]] : [coords[1], coords[15]];
        expect(top).toBeCloseTo(cursor, 0);
        if (link.item.amount > 1) expect(bottom - top).toBeCloseTo(link.thickness, 0);
        cursor += link.item.amount * layout.hub.height / flow.total;
        expect(link.d.endsWith(' Z')).toBe(true);
      });
      expect(cursor).toBeCloseTo(layout.hub.y + layout.hub.height, 0);
    }
  });
  it('leaves the label room free and places the hub between both columns', () => {
    const layout = layoutMoneyFlow(flow, { width: 500, height: 288, left: 100, right: 150, hubAt: 0.5 });
    expect(layout.nodes[0].x).toBe(100);
    expect(layout.nodes[1].x).toBe(340);
    expect(layout.hub.x).toBe(220);
    layout.links.forEach(link => {
      expect(link.x0).toBeGreaterThanOrEqual(110);
      expect(link.x1).toBeLessThanOrEqual(340);
    });
  });
  it('still fits when there is no room for the label of every node', () => {
    const nodes = layoutMoneyFlow(flow, { width: 500, height: 60 }).nodes.filter(node => node.side === 'destination');
    nodes.forEach(node => {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(60);
    });
    expect(nodes[1].center).toBeGreaterThan(nodes[0].center);
  });
});
