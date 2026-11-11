import { cn } from "@/lib/utils";
import type { ProposalAuthor as Author } from "./catalog";

export function ProposalAuthor({
  author,
  publishedAt,
  size = "md"
}: {
  author: Author;
  publishedAt?: string;
  size?: "md" | "lg";
}) {
  const name = author.link ? (
    <a
      href={author.link}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-line underline-offset-4 hover:decoration-ink"
    >
      {author.name}
    </a>
  ) : (
    author.name
  );
  return (
    <span className="flex items-center gap-3">
      <img
        src={author.avatar}
        alt=""
        width={96}
        height={96}
        loading="lazy"
        className={cn(
          "shrink-0 rounded-full border border-line bg-lavender/20 object-cover",
          size === "lg" ? "h-12 w-12" : "h-9 w-9"
        )}
      />
      <span className="flex flex-col">
        <span
          className={cn(
            "font-bold text-ink",
            size === "lg" ? "text-base" : "text-sm"
          )}
        >
          {name}
        </span>
        {publishedAt && (
          <time dateTime={publishedAt} className="text-xs text-muted">
            {new Date(`${publishedAt}T00:00:00Z`).toLocaleDateString("en", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC"
            })}
          </time>
        )}
      </span>
    </span>
  );
}
