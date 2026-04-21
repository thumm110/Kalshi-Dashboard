type Props = {
  value: string;
  onChange: (c: string) => void;
  categories: string[];
};

export function CategoryBar({ value, onChange, categories }: Props) {
  return (
    <nav className="border-b border-term-line bg-term-panel/60">
      <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto">
        {categories.map((c) => {
          const active = value === c;
          return (
            <button
              key={c}
              onClick={() => onChange(c)}
              className={
                "px-3 py-1 text-[12px] font-bold tracking-widest uppercase border transition-colors " +
                (active
                  ? "bg-term-greenBright/10 border-term-greenBright text-term-greenBright shadow-[0_0_8px_rgba(86,211,100,0.3)]"
                  : "border-term-line text-term-dim hover:text-term-text hover:border-term-dim")
              }
            >
              [{c}]
            </button>
          );
        })}
      </div>
    </nav>
  );
}
