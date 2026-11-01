import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  retrySolanaQuery,
  SolanaApiError,
  solanaCacheVersion
} from "@/lib/solanaIndexer";
import { pruneSolanaPages } from "@/lib/solanaPageCache";

type CursorPage = { nextCursor: string | null };
type PagingState = { cursors: string[]; position: number; pageNumber: number };
const initialState: PagingState = { cursors: [""], position: 0, pageNumber: 1 };

/** Keeps at most five page cursors and query responses for each view. */
export function useExomonPagination<T extends CursorPage>(
  identity: string,
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<T>
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PagingState>(initialState);
  const cursor = state.cursors[state.position] ?? "";
  const key = useMemo(
    () => [solanaCacheVersion, identity, cursor] as const,
    [identity, cursor]
  );
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchPage(cursor || undefined, signal),
    staleTime: 60_000,
    gcTime: 120_000,
    retry: retrySolanaQuery
  });

  useEffect(() => {
    if (!(query.error instanceof SolanaApiError) || query.error.status !== 409)
      return;
    queryClient.removeQueries({ queryKey: [solanaCacheVersion, identity] });
    setState(initialState);
  }, [query.error, queryClient, identity]);

  useEffect(() => {
    if (!query.dataUpdatedAt) return;
    pruneSolanaPages(queryClient, key);
  }, [query.dataUpdatedAt, queryClient, key]);

  function next() {
    const nextCursor = query.data?.nextCursor;
    if (!nextCursor) return;
    const old = state.cursors[0];
    const candidates = [
      ...state.cursors.slice(0, state.position + 1),
      nextCursor
    ];
    const trimmed = candidates.slice(-5);
    if (candidates.length > 5 && old !== undefined) {
      queryClient.removeQueries({
        queryKey: [solanaCacheVersion, identity, old],
        exact: true
      });
    }
    setState({
      cursors: trimmed,
      position: trimmed.length - 1,
      pageNumber: state.pageNumber + 1
    });
  }

  function previous() {
    if (state.position > 0)
      setState({
        ...state,
        position: state.position - 1,
        pageNumber: state.pageNumber - 1
      });
  }

  return {
    query,
    next,
    previous,
    canPrevious: state.position > 0,
    pageNumber: state.pageNumber
  };
}
