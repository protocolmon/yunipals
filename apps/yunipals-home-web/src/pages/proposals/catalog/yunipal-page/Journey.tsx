import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type JourneyStep = {
  key: string;
  when: ReactNode;
  title: ReactNode;
  note: ReactNode;
  /** The step that describes today; drawn as a filled dot. */
  current?: boolean;
};

const ROW = "flex flex-wrap items-center gap-x-1.5";

/** The journey as a logbook: dates in their own column, events beside them. */
export function Journey({ steps }: { steps: readonly JourneyStep[] }) {
  return (
    <ol className="mt-4">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            key={step.key}
            className="grid grid-cols-[5.5rem_1.25rem_minmax(0,1fr)] gap-x-2"
          >
            <p
              className={cn(
                "pt-0.5 text-right text-[11px] font-bold leading-snug",
                step.current ? "text-grape" : "text-muted"
              )}
            >
              {step.when}
            </p>
            <span aria-hidden="true" className="relative flex justify-center">
              {!last && (
                <span className="absolute bottom-0 top-3 w-px bg-ink/15" />
              )}
              <span
                className={cn(
                  "relative mt-1 h-3 w-3 rounded-full",
                  step.current
                    ? "bg-grape ring-4 ring-grape/15"
                    : "border-2 border-badge bg-white"
                )}
              />
            </span>
            <div className={cn("min-w-0", !last && "pb-5")}>
              <p className={cn(ROW, "text-[15px] font-bold text-ink")}>
                {step.title}
              </p>
              <p className={cn(ROW, "text-[13px] text-muted")}>{step.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
