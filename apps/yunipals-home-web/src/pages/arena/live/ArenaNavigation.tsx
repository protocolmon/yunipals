import { useArenaDeployment } from "@/lib/arenaDeployment";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

export function ArenaNavigation() {
  const deployment = useArenaDeployment();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Arena navigation" className="my-6 flex flex-wrap gap-2">
      {[
        [deployment.basePath, "Tournaments"],
        [`${deployment.basePath}/me`, "My Arena"],
        [`${deployment.basePath}/hosting`, "Hosting"],
        [`${deployment.basePath}/rules`, "Rules"],
        ...(deployment.kind === "anime"
          ? [["/arena/anime/studio", "Public queue"]]
          : [["/arena/anime", "Anime Arena"]])
      ].map(([href, label]) => {
        const active =
          pathname === href ||
          (href === deployment.basePath &&
            new RegExp(`^${deployment.basePath}/[0-9]+$`).test(pathname));
        return (
          <Link
            key={href}
            to={href!}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape",
              active
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink hover:bg-lavender/20"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
