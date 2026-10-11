import React from 'react';
import bbva from '../../assets/brands/bbva.png';
import caixabank from '../../assets/brands/caixabank.svg';
import ing from '../../assets/brands/ing.png';
import n26 from '../../assets/brands/n26.svg';
import revolut from '../../assets/brands/revolut.svg';
import sabadell from '../../assets/brands/sabadell.png';
import santander from '../../assets/brands/santander.png';
import traderepublic from '../../assets/brands/traderepublic.png';
import unicaja from '../../assets/brands/unicaja.png';
import { BANK_CATALOG, bankInitials, bankNameKey } from '../../utils/banks';

// `bg-white` follows the theme here, so the tile uses a literal white.
// Three kinds of artwork: single-colour marks (Simple Icons) drawn in white on the bank's colour,
// icons that already fill their square, and symbols on a transparent ground that need a white tile.
const logos: Record<string, { src: string; kind: 'mark' | 'tile' | 'symbol' }> = {
  caixabank: { src: caixabank, kind: 'mark' },
  n26: { src: n26, kind: 'mark' },
  revolut: { src: revolut, kind: 'mark' },
  bbva: { src: bbva, kind: 'tile' },
  ing: { src: ing, kind: 'tile' },
  sabadell: { src: sabadell, kind: 'tile' },
  santander: { src: santander, kind: 'symbol' },
  trade_republic: { src: traderepublic, kind: 'symbol' },
  unicaja: { src: unicaja, kind: 'symbol' },
};

const sizes = {
  md: { box: 'h-10 w-10 rounded-xl text-xs', mark: 'h-5 w-5', inset: 'p-1.5' },
  sm: { box: 'h-8 w-8 rounded-lg text-[10px]', mark: 'h-4 w-4', inset: 'p-1' },
};

export const BankBadge: React.FC<{ nombre: string; size?: keyof typeof sizes }> = ({ nombre, size = 'md' }) => {
  const bank = BANK_CATALOG.find(entry => bankNameKey(entry.nombre) === bankNameKey(nombre));
  const logo = bank ? logos[bank.id] : undefined;
  const { box, mark, inset } = sizes[size];
  const frame = `grid shrink-0 place-items-center overflow-hidden font-extrabold ${box}`;

  if (!bank || !logo) {
    return (
      <span
        aria-hidden="true"
        className={`${frame} ${bank ? 'border border-white/10 text-white' : 'bg-brand-tint text-brand-ink'}`}
        style={bank ? { backgroundColor: bank.color } : undefined}
      >
        {bankInitials(nombre)}
      </span>
    );
  }
  if (logo.kind === 'mark') {
    return (
      <span aria-hidden="true" className={`${frame} border border-white/10`} style={{ backgroundColor: bank.color }}>
        <img src={logo.src} alt="" className={`${mark} brightness-0 invert`} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${frame} border border-line bg-[#fff]`}>
      <img
        src={logo.src}
        alt=""
        className={logo.kind === 'tile' ? 'h-full w-full object-cover' : `h-full w-full object-contain ${inset}`}
      />
    </span>
  );
};
