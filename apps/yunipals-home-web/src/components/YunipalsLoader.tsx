import { cn } from "@/lib/utils";

export function YunipalsLoader({
  label,
  detail,
  className,
  state = "loading"
}: {
  label: string;
  detail?: string;
  className?: string;
  state?: "loading" | "waiting";
}) {
  return (
    <div
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-5", className)}
    >
      <span className="yunipals-loader-mark" aria-hidden="true">
        <span className="yunipals-loader-orbit" />
        <img src="/images/yunipals-logo.webp" alt="" width={64} height={64} />
        <span className="yunipals-loader-spark" />
      </span>
      <div className="min-w-0">
        <p className="font-bold">{label}</p>
        {detail && <p className="mt-2 text-sm opacity-75">{detail}</p>}
      </div>
    </div>
  );
}
