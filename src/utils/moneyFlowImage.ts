import type { MoneyFlow } from './moneyFlow';
import { layoutMoneyFlow } from './moneyFlowLayout';

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const INK = '#0f131b';

export function moneyFlowSvg(flow: MoneyFlow, periodLabel: string): string {
  const layout = layoutMoneyFlow(flow, { width: 1056, height: 560, left: 200, right: 300, nodeWidth: 14, gap: 8, minSlot: 52 });
  const gradients = layout.links.map(({ item, x0, x1 }, i) => item.color
    ? `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${x0}" x2="${x1}" y1="0" y2="0"><stop offset="0" stop-color="${item.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${item.color}" stop-opacity="0.55"/></linearGradient>`
    : '').join('');
  const links = layout.links.map(({ item, d }, i) =>
    `<path d="${d}" fill="${item.color ? `url(#g${i})` : INK}" fill-opacity="${item.color ? 1 : 0.08}"/>`).join('');
  const nodes = layout.nodes.map(({ item, side, x, y, width, height, center }) => {
    const text = side === 'source' ? `x="${x - 16}" text-anchor="end"` : `x="${x + width + 16}" text-anchor="start"`;
    const label = item.label.length > 24 ? `${item.label.slice(0, 23)}…` : item.label;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(4, height / 2)}" fill="${item.color ?? INK}" fill-opacity="${item.color ? 1 : 0.65}"/><text ${text} y="${center - 3}" font-size="22" font-weight="700" fill="${INK}">${escapeText(label)}</text><text ${text} y="${center + 21}" font-size="19" font-weight="600" fill="#586377">${item.percent} %</text>`;
  }).join('');
  const { hub } = layout;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"><defs>${gradients}</defs><rect width="1200" height="900" fill="#ffffff"/><text x="72" y="118" font-size="46" font-weight="800" fill="${INK}">A dónde va mi dinero</text><text x="72" y="162" font-size="24" font-weight="500" fill="#586377">${escapeText(periodLabel)}</text><g transform="translate(72 222)">${links}<rect x="${hub.x}" y="${hub.y}" width="${hub.width}" height="${hub.height}" rx="4" fill="${INK}" fill-opacity="0.3"/>${nodes}</g><text x="72" y="846" font-size="20" fill="#8792a4">Solo porcentajes · sin importes</text><circle cx="1034" cy="837" r="9" fill="none" stroke="#ff9f0a" stroke-width="5"/><text x="1128" y="846" text-anchor="end" font-size="26" font-weight="800" fill="${INK}">Flowt</text></svg>`;
}

export function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    const fail = (error: unknown) => { URL.revokeObjectURL(url); reject(error); };
    image.onerror = () => fail(new Error('Unable to load SVG'));
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('Unable to create PNG'));
        }, 'image/png');
      } catch (error) { fail(error); }
    };
    try { image.src = url; }
    catch (error) { fail(error); }
  });
}
