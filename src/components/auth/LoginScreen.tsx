import { ArrowRight, ArrowUpRight, Lock, PiggyBank, Plane, ShoppingBag } from 'lucide-react';
import { FlowtLogo } from '../common/FlowtLogo';
import { walletAccent } from '../../utils/walletAccent';

interface LoginScreenProps {
  onLogin: () => void;
  onDemo: () => void;
  /** The account that just signed in is not allowed to use Flowt. */
  accessDenied?: boolean;
}

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const WALLETS = [
  { name: 'Ahorro', rule: '20 %', amount: '+490 €', fill: 0.62, icon: PiggyBank },
  { name: 'Viaje a Japón', rule: '15 %', amount: '+367,50 €', fill: 0.34, icon: Plane },
  { name: 'Día a día', rule: 'Resto', amount: '+1.592,50 €', fill: 0.8, icon: ShoppingBag },
];

/** What Flowt does, in one picture: an income arrives and splits itself. */
const SplitPreview = () => (
  <div aria-hidden="true" className="relative mx-auto w-full max-w-md select-none lg:max-w-xl">
    {/* The two logo colours, glowing from behind the card */}
    <div className="pointer-events-none absolute -inset-x-10 -inset-y-14 -z-10 bg-[radial-gradient(closest-side_at_30%_40%,rgba(99,102,241,0.32),transparent),radial-gradient(closest-side_at_80%_72%,rgba(255,159,10,0.18),transparent)] blur-2xl" />
    <div className="flowt-card p-4 sm:p-5 lg:p-8">
    <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl border border-line bg-surface-2 py-2 pl-2 pr-4 lg:gap-4 lg:py-3 lg:pl-3 lg:pr-6">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 lg:h-11 lg:w-11">
        <ArrowUpRight size={18} />
      </span>
      <div className="leading-tight">
        <p className="text-[11px] font-semibold text-ink-soft lg:text-xs">Nómina · hoy</p>
        <p className="figure mt-0.5 text-lg text-ink lg:text-2xl">+2.450,00 €</p>
      </div>
    </div>

    <svg viewBox="0 0 300 64" preserveAspectRatio="none" className="block h-12 w-full sm:h-16 lg:h-24">
      {['M150 0C150 40 50 24 50 64', 'M150 0V64', 'M150 0C150 40 250 24 250 64'].map((d, i) => (
        <g key={d} stroke={walletAccent(i).hex} fill="none" strokeLinecap="round">
          <path d={d} strokeWidth="1.5" opacity="0.28" vectorEffect="non-scaling-stroke" />
          <path
            d={d}
            strokeWidth="2.5"
            strokeDasharray="1 23"
            vectorEffect="non-scaling-stroke"
            style={{
              ['--flow-gap' as string]: 24,
              animation: `flow-travel 900ms linear ${i * -300}ms infinite`,
            }}
          />
        </g>
      ))}
    </svg>

    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {WALLETS.map(({ name, rule, amount, fill, icon: Icon }, i) => {
        const accent = walletAccent(i);
        return (
          <div
            key={name}
            className="rise min-w-0 rounded-2xl border border-line bg-surface-2 p-2.5 sm:p-3 lg:p-4"
            style={{ ['--i' as string]: i + 3 }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`grid h-7 w-7 place-items-center rounded-lg lg:h-9 lg:w-9 lg:rounded-xl ${accent.chip}`}>
                <Icon size={15} />
              </span>
              <span className="text-[10px] font-bold text-ink-faint lg:text-xs">{rule}</span>
            </div>
            <p className="mt-2 truncate text-[11px] font-semibold text-ink-soft lg:mt-3 lg:text-xs">{name}</p>
            <p className="figure mt-0.5 truncate text-[13px] text-ink sm:text-sm lg:mt-1 lg:text-lg">{amount}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-strong lg:mt-3 lg:h-1.5">
              <div
                className={`h-full origin-left rounded-full ${accent.fill}`}
                style={{
                  width: `${fill * 100}%`,
                  animation: `fill-up 1100ms var(--ease-soft) ${500 + i * 140}ms backwards`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
    </div>
    <p className="mt-4 text-center text-xs text-ink-faint">
      Entra una nómina y se reparte sola, según tus reglas.
    </p>
  </div>
);

export function LoginScreen({ onLogin, onDemo, accessDenied = false }: LoginScreenProps) {
  return (
    <main className="app-canvas min-h-dvh font-sans">
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl content-center items-center gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <section className="min-w-0">
          <div className="rise flex items-center gap-2.5" style={{ ['--i' as string]: 0 }}>
            <FlowtLogo size={34} animated />
            <span className="font-display text-2xl font-bold tracking-tight text-ink">Flowt</span>
          </div>

          <h1
            className="rise mt-7 text-[2.75rem] font-bold leading-[0.98] tracking-[-0.04em] text-ink sm:text-6xl lg:mt-10 lg:text-7xl"
            style={{ ['--i' as string]: 1 }}
          >
            Cada euro,
            <br />
            <span className="text-brand-ink">en su sitio.</span>
          </h1>

          <p
            className="rise mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft sm:mt-5 sm:text-base"
            style={{ ['--i' as string]: 2 }}
          >
            Tus ingresos se reparten solos entre tus carteras y cada gasto se apunta sin que hagas
            nada. Tú solo entras a ver cómo va.
          </p>

          <div className="rise mt-6 lg:hidden" style={{ ['--i' as string]: 3 }}>
            <SplitPreview />
          </div>

          <div
            className="rise mt-6 flex max-w-lg flex-col gap-2.5 sm:mt-8 sm:flex-row"
            style={{ ['--i' as string]: 4 }}
          >
            <button
              type="button"
              onClick={onLogin}
              className="group inline-flex h-13 shrink-0 items-center justify-center gap-3 rounded-2xl bg-ink sm:flex-1 px-5 text-[15px] font-bold text-page shadow-[0_14px_30px_-16px_var(--ink)] transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white">
                <GoogleMark />
              </span>
              Acceder con Google
            </button>
            <button
              type="button"
              onClick={onDemo}
              className="group inline-flex h-13 shrink-0 items-center justify-center gap-2 rounded-2xl border border-line-strong bg-surface px-5 text-[15px] font-bold text-ink transition-colors duration-150 hover:bg-surface-2"
            >
              Explorar en modo demo
              <ArrowRight
                size={16}
                className="text-sun-500 transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </button>
          </div>

          {accessDenied && (
            <p role="alert" className="notice is-danger mt-4 max-w-lg">
              Esta cuenta no tiene acceso. Flowt es privada; puedes explorar la demo.
            </p>
          )}

          <p
            className="rise mt-4 flex items-center gap-1.5 text-xs text-ink-faint"
            style={{ ['--i' as string]: 5 }}
          >
            <Lock size={12} />
            Acceso seguro con tu cuenta de Google. La demo no necesita cuenta.
          </p>
        </section>

        <section className="rise hidden min-w-0 lg:block" style={{ ['--i' as string]: 2 }}>
          <SplitPreview />
        </section>
      </div>
    </main>
  );
}
