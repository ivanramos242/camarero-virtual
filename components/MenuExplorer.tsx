import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Grid2x2, Leaf, List, Plus, Wheat } from 'lucide-react';

import type { MenuItem } from '../types';

interface MenuExplorerProps {
  menu: MenuItem[];
  onAddItem: (item: MenuItem) => void;
}

const MenuExplorer: React.FC<MenuExplorerProps> = ({ menu, onAddItem }) => {
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [mobileView, setMobileView] = useState<'grid' | 'list'>('grid');
  const categoryRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const categories = useMemo(() => ['Todos', ...Array.from(new Set(menu.map((item) => item.category)))], [menu]);

  const filteredMenu = useMemo(() => {
    if (activeCategory === 'Todos') {
      return menu;
    }

    return menu.filter((item) => item.category === activeCategory);
  }, [activeCategory, menu]);

  const renderDietIcon = (diet: string) => {
    const normalisedDiet = diet.toLowerCase();

    if (normalisedDiet.includes('veg')) {
      return <Leaf size={12} />;
    }

    if (normalisedDiet.includes('gluten') || normalisedDiet.includes('celi')) {
      return <Wheat size={12} />;
    }

    return null;
  };

  useEffect(() => {
    const activeButton = categoryRefs.current[activeCategory];
    if (!activeButton) return;

    activeButton.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [activeCategory]);

  return (
    <section className="panel -mx-4 w-[calc(100%+2rem)] overflow-hidden rounded-none border-x-0 sm:mx-0 sm:w-auto sm:rounded-[12px] sm:border">
      <div className="border-b border-stone-200 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-stone-900">Carta disponible</h2>
        <p className="mt-1 text-sm text-stone-500">Anade platos manualmente si prefieres no usar la voz.</p>
      </div>

      <div className="scrollbar-thin flex gap-2 overflow-x-auto border-b border-stone-200 px-4 py-3 sm:px-5">
        {categories.map((category) => (
          <button
            key={category}
            ref={(element) => {
              categoryRefs.current[category] = element;
            }}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`whitespace-nowrap rounded-lg px-3 py-2.5 text-sm transition ${
              activeCategory === category ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="border-b border-stone-200 px-4 py-3 sm:hidden">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-stone-100 p-1">
          <button
            type="button"
            onClick={() => setMobileView('grid')}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
              mobileView === 'grid' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
            aria-pressed={mobileView === 'grid'}
            aria-label="Vista en cuadricula"
            title="Vista en cuadricula"
          >
            <Grid2x2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
              mobileView === 'list' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'
            }`}
            aria-pressed={mobileView === 'list'}
            aria-label="Vista en lista"
            title="Vista en lista"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      <div
        className={`p-3 sm:p-5 ${
          mobileView === 'grid'
            ? 'grid grid-cols-2 gap-2.5 md:grid-cols-2 md:gap-4 xl:grid-cols-3'
            : 'flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-3'
        }`}
      >
        {filteredMenu.map((item) => {
          const isVegan = item.dietary.some((diet) => diet.toLowerCase().includes('veg'));
          const secondaryDietary = item.dietary.filter((diet) => !diet.toLowerCase().includes('veg'));
          const isGrid = mobileView === 'grid';
          const shouldShowImage = Boolean(item.imageUrl);

          return (
            <article
              key={item.id}
              className={`overflow-hidden rounded-xl border border-stone-200 bg-white ${
                isGrid || !shouldShowImage ? '' : 'flex items-stretch sm:block'
              }`}
            >
              {shouldShowImage ? (
                <div className={`relative overflow-hidden bg-stone-100 ${isGrid ? '' : 'w-28 shrink-0 sm:w-auto'}`}>
                  <img
                    src={item.imageUrl!}
                    alt={item.name}
                    className={`w-full object-cover ${isGrid ? 'h-28' : 'h-full min-h-28 sm:h-40'}`}
                  />

                  {isVegan ? (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/92 px-2 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur">
                      <Leaf size={12} />
                      Vegano
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className={`flex items-center justify-center bg-stone-100 px-3 text-center text-xs text-stone-400 sm:text-sm ${isGrid ? 'h-28' : 'min-h-28 sm:h-40'}`}>
                  {item.category}
                </div>
              )}

              <div className={`p-3 sm:p-4 ${isGrid ? 'space-y-2.5' : 'flex min-w-0 flex-1 flex-col justify-between space-y-3'}`}>
                <div className={`gap-2 ${isGrid ? 'space-y-1.5' : 'flex items-start justify-between'}`}>
                  <div className="min-w-0">
                    <h3 className={`font-semibold text-stone-900 ${isGrid ? 'line-clamp-2 text-[13px] leading-4.5' : 'text-sm sm:text-base'}`}>
                      {item.name}
                    </h3>
                    {!shouldShowImage && isVegan ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        <Leaf size={12} />
                        Vegano
                      </span>
                    ) : null}
                    <p
                      className={`mt-1 text-xs text-stone-500 ${
                        isGrid ? 'line-clamp-2 leading-4' : 'line-clamp-2 leading-4 sm:text-sm sm:leading-6'
                      }`}
                    >
                      {item.description}
                    </p>
                  </div>
                  <span className={`block font-medium ${isGrid ? 'text-sm text-stone-900' : 'shrink-0 text-sm text-stone-700'}`}>
                    {item.price.toFixed(2)} €
                  </span>
                </div>

                {!isGrid && secondaryDietary.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {secondaryDietary.map((diet) => (
                      <span
                        key={diet}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800"
                      >
                        {renderDietIcon(diet)}
                        {diet}
                      </span>
                    ))}
                  </div>
                ) : null}

                {!isGrid && item.allergens.length > 0 ? (
                  <p className="inline-flex items-center gap-1 text-xs text-stone-500">
                    <AlertCircle size={12} />
                    Alergenos: {item.allergens.join(', ')}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={() => onAddItem(item)}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-800 transition hover:bg-stone-50 ${
                    isGrid ? 'min-h-9 py-2' : 'min-h-11 py-3'
                  }`}
                >
                  <Plus size={isGrid ? 14 : 16} />
                  Anadir
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default MenuExplorer;
