import { AlertCircle, RefreshCw } from "lucide-react";

type QueryErrorProps = {
  message?: string;
  onRetry?: () => void;
};

export function QueryError({
  message = "The Yunipals indexer could not be reached.",
  onRetry
}: QueryErrorProps) {
  return (
    <div className="rounded-card border border-red-200 bg-red-50 px-6 py-8 text-center text-red-800">
      <AlertCircle aria-hidden="true" className="mx-auto" size={24} />
      <p className="mt-3 text-sm font-semibold">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-red-300 bg-white px-4 py-2 text-sm font-bold transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <RefreshCw aria-hidden="true" size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function TokenGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-card border border-line bg-white"
          aria-hidden="true"
        >
          <div className="aspect-square animate-pulse bg-line/65" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-line/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
