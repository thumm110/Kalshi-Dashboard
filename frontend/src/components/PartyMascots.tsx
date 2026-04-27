type Props = { className?: string };

// Using Unicode emoji — guaranteed crisp rendering across systems.
// 🫏 Donkey (U+1FACF, Unicode 15, 2022) · 🐘 Elephant.
export function DonkeyIcon({ className }: Props) {
  return (
    <span className={className} role="img" aria-label="Democrat donkey" style={{ fontSize: "1em", lineHeight: 1 }}>
      🫏
    </span>
  );
}

export function ElephantIcon({ className }: Props) {
  return (
    <span className={className} role="img" aria-label="Republican elephant" style={{ fontSize: "1em", lineHeight: 1 }}>
      🐘
    </span>
  );
}
