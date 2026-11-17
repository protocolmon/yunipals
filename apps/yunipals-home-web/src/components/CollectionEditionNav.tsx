import { Link } from "react-router-dom";

import {
  collectionEditions,
  type CollectionEdition
} from "@/lib/collectionEdition";
import { islandsCollectionHref } from "@/lib/islandsIndexer";
import { cn } from "@/lib/utils";

const labels = { og: "OG", airdrop: "OG Base", tcg: "TCG" };

export function CollectionEditionNav({
  edition,
  href,
  className,
  islandsHref = islandsCollectionHref
}: {
  edition?: CollectionEdition | "islands";
  href: (edition: CollectionEdition) => string;
  className?: string;
  islandsHref?: string | null;
}) {
  const tabs = [
    ...collectionEditions.map((value) => ({
      value,
      label: labels[value],
      to: href(value)
    })),
    ...(islandsHref
      ? [{ value: "islands", label: "Islands", to: islandsHref }]
      : [])
  ];
  return (
    <nav
      aria-label="Yunipals collections"
      className={cn("mb-4 flex gap-2", className)}
    >
      {tabs.map(({ value, label, to }) => (
        <Link
          key={value}
          to={to}
          aria-current={edition === value ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-full border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2 sm:flex-none sm:px-5 sm:text-sm",
            edition === value
              ? "border-grape bg-grape text-white"
              : "border-line bg-white text-ink hover:bg-lavender/40"
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
