import { Link } from "react-router-dom";

import { islandsCollectionHref } from "@/lib/islandsIndexer";
import { cn } from "@/lib/utils";

export function CollectionTabs({
  selected
}: {
  selected: "yunipals" | "islands";
}) {
  return (
    <nav
      aria-label="Collections"
      className="border-b border-line bg-white px-4 py-4"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        {[
          { id: "yunipals", label: "Yunipals", href: "/" },
          { id: "islands", label: "Islands", href: islandsCollectionHref }
        ].map((collection) => (
          <Link
            key={collection.id}
            to={collection.href}
            aria-current={selected === collection.id ? "page" : undefined}
            className={cn(
              "rounded-full px-5 py-2 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2",
              selected === collection.id
                ? "bg-ink text-white"
                : "bg-line/40 text-muted hover:bg-lavender/40 hover:text-ink"
            )}
          >
            {collection.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
