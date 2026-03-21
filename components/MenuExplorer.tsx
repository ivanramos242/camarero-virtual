import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Leaf, Plus, Wheat } from 'lucide-react';

import type { MenuItem } from '../types';

interface MenuExplorerProps {
  menu: MenuItem[];
  onAddItem: (item: MenuItem) => void;
}

const MenuExplorer: React.FC<MenuExplorerProps> = ({ menu, onAddItem }) => {
  const [activeCategory, setActiveCategory] = useState('Todos');
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
    <section className="panel min-w-0 overflow-hidden">
      <div className="border-b border-stone-200 px-5 py-4">
        <h2 className="text-base font-semibold text-stone-900">Carta disponible</h2>
        <p className="mt-1 text-sm text-stone-500">Añade platos manualmente si prefieres no usar la voz.</p>
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

      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
        {filteredMenu.map((item) => (
          <article key={item.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            {item.imageUrl ? (
              <img src={item.imageUrl} alt={item.name} className="h-36 w-full object-cover sm:h-40" />
            ) : (
              <div className="flex h-36 items-center justify-center bg-stone-100 px-4 text-center text-sm text-stone-400 sm:h-40">{item.category}</div>
            )}

            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-stone-900">{item.name}</h3>
                  <p className="mt-1 text-sm leading-6 text-stone-500">{item.description}</p>
                </div>
                <span className="shrink-0 text-sm font-medium text-stone-700">{item.price.toFixed(2)} €</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {item.dietary.map((diet) => (
                  <span
                    key={diet}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800"
                  >
                    {renderDietIcon(diet)}
                    {diet}
                  </span>
                ))}
              </div>

              {item.allergens.length > 0 ? (
                <p className="inline-flex items-center gap-1 text-xs text-stone-500">
                  <AlertCircle size={12} />
                  Alérgenos: {item.allergens.join(', ')}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => onAddItem(item)}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
              >
                <Plus size={16} />
                Añadir al pedido
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

export default MenuExplorer;
