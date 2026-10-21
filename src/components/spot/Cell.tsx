/** One «label value» pair of the spot card's data grid. */
export function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-slate-500 text-[11px]">{label}</span>
      <span className="font-bold text-slate-200" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
