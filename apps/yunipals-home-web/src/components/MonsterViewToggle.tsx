import { cn } from "@/lib/utils";

export function MonsterViewToggle({
  grouped,
  disabled,
  onChange
}: {
  grouped: boolean;
  disabled?: boolean;
  onChange: (view: "grouped" | "nfts") => void;
}) {
  return (
    <div
      role="group"
      aria-label="Collection display"
      className="flex flex-wrap gap-2"
    >
      {(
        [
          ["grouped", "Grouped monsters"],
          ["nfts", "All NFTs"]
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={grouped === (value === "grouped")}
          disabled={value === "grouped" && disabled}
          onClick={() => onChange(value)}
          className={cn(
            "rounded-full border border-line px-4 py-2 text-sm font-bold disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ethereum",
            grouped === (value === "grouped")
              ? "bg-ink text-white"
              : "bg-white text-ink"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
