interface ContextMeterProps {
  used: number;
  max: number;
}

export default function ContextMeter({ used, max }: ContextMeterProps) {
  const percentage = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const displayUsed = used >= 1000 ? `${Math.round(used / 1000)}K` : `${used}`;
  const displayMax = max >= 1000 ? `${Math.round(max / 1000)}K` : `${max}`;

  let barColor = "bg-accent";
  if (percentage > 90) barColor = "bg-red";
  else if (percentage > 70) barColor = "bg-yellow";

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-label text-text-dim font-medium tracking-wider uppercase">
          Context
        </span>
        <span className="text-label text-text-faint">
          {displayUsed} / {displayMax}
        </span>
      </div>
      <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
