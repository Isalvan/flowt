import React from 'react';

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 transition-colors duration-300 font-sans pb-24">
      {/* 1. Header Navbar Skeleton */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-white/5 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          
          {/* Logo brand placeholder */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl shimmer-placeholder shrink-0" />
            <div className="space-y-2">
              <div className="w-16 h-4 rounded shimmer-placeholder" />
              <div className="w-20 h-2.5 rounded shimmer-placeholder" />
            </div>
          </div>

          {/* Nav Tabs placeholder */}
          <div className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200/40 dark:border-white/5 rounded-2xl">
            <div className="w-24 h-8 rounded-xl shimmer-placeholder" />
            <div className="w-28 h-8 rounded-xl shimmer-placeholder" />
            <div className="w-24 h-8 rounded-xl shimmer-placeholder" />
            <div className="w-20 h-8 rounded-xl shimmer-placeholder" />
          </div>

          {/* Quick utilities placeholder */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl shimmer-placeholder" />
            <div className="w-10 h-10 rounded-xl shimmer-placeholder" />
            <div className="w-24 h-10 rounded-2xl shimmer-placeholder" />
          </div>
        </div>
      </header>

      {/* 2. Main Content Skeleton */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
        
        {/* Title and main buttons */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2.5">
            <div className="w-36 h-8 rounded-lg shimmer-placeholder" />
            <div className="w-56 h-4 rounded shimmer-placeholder" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-28 h-9.5 rounded-xl shimmer-placeholder" />
            <div className="w-32 h-9.5 rounded-xl shimmer-placeholder" />
            <div className="w-36 h-9.5 rounded-xl shimmer-placeholder" />
          </div>
        </div>

        {/* 4 Stat Cards shimmer */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div 
              key={i} 
              className="p-5 rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-white/5 h-32 flex flex-col justify-between"
            >
              <div className="flex justify-between items-center">
                <div className="w-28 h-3.5 rounded shimmer-placeholder" />
                <div className="w-5 h-5 rounded-full shimmer-placeholder" />
              </div>
              <div className="space-y-2">
                <div className="w-24 h-7.5 rounded-lg shimmer-placeholder" />
                <div className="w-36 h-3 rounded shimmer-placeholder" />
              </div>
            </div>
          ))}
        </div>

        {/* Carteras shimmer */}
        <div className="space-y-4">
          <div className="w-40 h-4.5 rounded shimmer-placeholder" />
          <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div 
                key={i} 
                className="p-6 rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-white/5 h-44 flex flex-col justify-between"
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-3">
                    <div className="w-28 h-5.5 rounded shimmer-placeholder" />
                    <div className="w-20 h-5 rounded-lg shimmer-placeholder" />
                  </div>
                  <div className="flex gap-1">
                    <div className="w-8 h-8 rounded-xl shimmer-placeholder" />
                    <div className="w-8 h-8 rounded-xl shimmer-placeholder" />
                  </div>
                </div>
                <div className="flex justify-between items-end">
                  <div className="space-y-2">
                    <div className="w-32 h-7.5 rounded-lg shimmer-placeholder" />
                    <div className="w-24 h-3.5 rounded shimmer-placeholder" />
                  </div>
                  <div className="w-14 h-14 rounded-full shimmer-placeholder" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Evolution Chart shimmer */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 p-6 rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-white/5 h-96 flex flex-col justify-between">
            <div className="flex justify-between items-center border-b border-slate-150 dark:border-white/5 pb-4">
              <div className="space-y-2">
                <div className="w-40 h-5.5 rounded shimmer-placeholder" />
                <div className="w-56 h-3 rounded shimmer-placeholder" />
              </div>
              <div className="w-28 h-8 rounded-2xl shimmer-placeholder" />
            </div>
            <div className="w-full h-64 rounded-xl shimmer-placeholder" />
          </div>
          
          <div className="p-6 rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-slate-100 dark:border-white/5 h-96 flex flex-col justify-between">
            <div className="border-b border-slate-150 dark:border-white/5 pb-4 space-y-2">
              <div className="w-36 h-5.5 rounded shimmer-placeholder" />
              <div className="w-40 h-3 rounded shimmer-placeholder" />
            </div>
            <div className="w-36 h-36 rounded-full shimmer-placeholder mx-auto my-3" />
            <div className="space-y-2">
              <div className="w-full h-8 rounded-lg shimmer-placeholder" />
              <div className="w-full h-8 rounded-lg shimmer-placeholder" />
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};
