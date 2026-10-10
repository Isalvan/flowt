import React from 'react';
import { FlowtLogo } from '../common/FlowtLogo';

/** Mirrors the dashboard's real layout so nothing jumps when the data lands. */
export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="app-canvas min-h-screen pb-28 font-sans md:pb-12" aria-busy="true" aria-label="Cargando Flowt">
      <header className="sticky top-0 z-30 border-b border-line bg-page/75 backdrop-blur-xl">
        <div className="flowt-container mx-auto flex h-14 items-center justify-between gap-3 sm:h-16">
          <div className="flex items-center gap-2.5">
            <FlowtLogo size={28} />
            <span className="font-display text-xl font-bold leading-none tracking-tight text-ink">Flowt</span>
          </div>
          <div className="hidden h-10 w-[26rem] rounded-full shimmer-placeholder md:block" />
          <div className="flex items-center gap-1.5">
            <div className="h-9 w-9 rounded-xl shimmer-placeholder" />
            <div className="h-9 w-9 rounded-xl shimmer-placeholder" />
            <div className="h-9 w-9 rounded-full shimmer-placeholder" />
          </div>
        </div>
      </header>

      <main className="flowt-container mx-auto mt-5 space-y-5 sm:mt-8 sm:space-y-7">
        {/* Greeting and actions */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2.5">
            <div className="h-9 w-56 rounded-xl shimmer-placeholder" />
            <div className="h-4 w-40 rounded shimmer-placeholder" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-10 flex-1 rounded-xl shimmer-placeholder md:w-44 md:flex-none" />
            <div className="h-8 w-24 rounded-full shimmer-placeholder" />
            <div className="h-10 w-11 rounded-xl shimmer-placeholder sm:w-36" />
          </div>
        </div>

        {/* Balance */}
        <div className="dashboard-surface p-5 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-end lg:gap-10">
            <div className="space-y-4">
              <div className="h-3 w-24 rounded shimmer-placeholder" />
              <div className="h-12 w-64 max-w-full rounded-xl shimmer-placeholder sm:h-14" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="h-20 rounded-2xl shimmer-placeholder" />
              <div className="h-20 rounded-2xl shimmer-placeholder" />
            </div>
          </div>
          <div className="mt-6 h-2 rounded-full shimmer-placeholder" />
        </div>

        {/* Wallets */}
        <div className="space-y-3">
          <div className="h-5 w-32 rounded shimmer-placeholder" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`dashboard-surface h-36 flex-col justify-between p-4 ${i > 0 ? 'hidden sm:flex' : 'flex'} ${i > 2 ? 'lg:hidden xl:flex' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl shimmer-placeholder" />
                  <div className="space-y-2">
                    <div className="h-3.5 w-28 rounded shimmer-placeholder" />
                    <div className="h-2.5 w-20 rounded shimmer-placeholder" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-6 w-32 rounded-lg shimmer-placeholder" />
                  <div className="h-1.5 rounded-full shimmer-placeholder" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart and upcoming charges */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="dashboard-surface h-96 p-5 lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl shimmer-placeholder" />
              <div className="space-y-2">
                <div className="h-4 w-44 rounded shimmer-placeholder" />
                <div className="h-3 w-56 max-w-full rounded shimmer-placeholder" />
              </div>
            </div>
            <div className="mt-5 h-64 rounded-2xl shimmer-placeholder" />
          </div>
          <div className="dashboard-surface hidden h-96 p-5 lg:block">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl shimmer-placeholder" />
              <div className="h-4 w-36 rounded shimmer-placeholder" />
            </div>
            <div className="mt-6 space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 rounded-xl shimmer-placeholder" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
