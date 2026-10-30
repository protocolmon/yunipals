import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useArenaDeployment } from "@/lib/arenaDeployment";
import { ArenaNavigation, type ArenaSection } from "./ArenaNavigation";

export function ArenaPageHeader({
  title,
  description,
  section
}: {
  title: string;
  description: string;
  section?: ArenaSection;
}) {
  const deployment = useArenaDeployment();
  return (
    <>
      <Link
        to="/arena"
        className="mb-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-muted hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Battle modes
      </Link>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-grape">
          {deployment.label}
        </p>
        <h1 className="mt-3 font-display text-3xl sm:text-4xl md:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          {description}
        </p>
      </header>
      <ArenaNavigation section={section} />
    </>
  );
}
