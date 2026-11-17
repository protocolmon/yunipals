import { CollectionEditionNav } from "@/components/CollectionEditionNav";
import { readSavedCollectionFilters } from "@/lib/collectionEdition";

export function CollectionTabs() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-5 sm:pt-6">
      <CollectionEditionNav
        edition="islands"
        href={(edition) =>
          `/?${readSavedCollectionFilters(edition) ?? `edition=${edition}`}#collection`
        }
      />
    </div>
  );
}
