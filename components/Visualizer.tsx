import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number;
}

const bars = [0.7, 1, 0.82, 0.54, 0.9];

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const intensity = isActive ? Math.max(0.2, Math.min(volume * 3.2, 1)) : 0.08;

  return (
    <div className="flex h-24 items-end justify-center gap-2">
      {bars.map((bar, index) => {
        const height = `${24 + 42 * bar * intensity}px`;
        return (
          <span
            key={index}
            className={`w-2 rounded-full transition-[height,background-color] duration-150 ${
              isActive ? 'bg-amber-600' : 'bg-stone-300'
            }`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
};

export default Visualizer;
