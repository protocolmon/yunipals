import { useQuery } from "@tanstack/react-query";
import { environment } from "@/environment";
import { boosterQueryKey, fetchMonsterArtwork } from "@/lib/boosters";

export function BoosterBirthDetails({
  collection,
  tokenId
}: {
  collection: string;
  tokenId: string;
}) {
  const query = useQuery({
    queryKey: [...boosterQueryKey, "birth-metadata", collection, tokenId],
    queryFn: ({ signal }) =>
      fetchMonsterArtwork(
        `${environment.yunipalsIndexerUrl}/v1/boosters/metadata/${collection}/${tokenId}.json`,
        signal
      ),
    staleTime: 10000,
    refetchInterval: 15000,
    retry: 1
  });
  const attributes = query.data?.attributes;
  const day = attributes?.["birth day"];
  const born = attributes?.born;
  const valid =
    day !== undefined &&
    /^(0|[1-9][0-9]*)$/.test(day) &&
    born !== undefined &&
    /^[1-9][0-9]{0,11}$/.test(born);
  if (!valid)
    return (
      <p role="status" className="mt-5 text-sm text-muted">
        {query.isPending
          ? "Loading birth details…"
          : "Birth details are being prepared."}
      </p>
    );
  const date = new Date(Number(born) * 1000);
  return (
    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted">Birth day</dt>
        <dd className="font-bold">Day {day}</dd>
        <p className="mt-1 text-xs text-muted">
          Days after the original was minted
        </p>
      </div>
      <div>
        <dt className="text-muted">Born</dt>
        <dd className="font-bold">
          <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>
        </dd>
      </div>
    </dl>
  );
}
