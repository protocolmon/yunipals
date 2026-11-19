import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

import { environment } from "@/environment";
import {
  metadataEntries,
  resolvePageMetadata,
  type PageMetadata
} from "@/lib/social/metadata";
export { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/social/metadata";

function pageMetadata(pathname: string, search: string) {
  return resolvePageMetadata(
    new URL(`${pathname}${search}`, environment.siteOrigin),
    {
      siteOrigin: environment.siteOrigin,
      exomonEnabled: environment.exomonEnabled,
      staticRevision: environment.socialImageRevision
    }
  );
}

export function applyPageMetadata(meta: PageMetadata) {
  document.title = meta.title;
  for (const [attribute, key, content] of metadataEntries(meta)) {
    let element = document.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`
    );
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = content;
  }
  let canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = meta.canonical;
}

/** Route metadata is reset before painting; loaded page data may refine the
 * title afterwards. Unmounting pages never restore stale homepage metadata. */
export function RouteMetadata() {
  const { pathname, search } = useLocation();
  useLayoutEffect(() => {
    applyPageMetadata(pageMetadata(pathname, search));
  }, [pathname, search]);
  return null;
}

export function usePageMetadata(title: string, description?: string) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const meta = pageMetadata(pathname, search);
    applyPageMetadata({
      ...meta,
      title,
      description: description ?? meta.description
    });
  }, [pathname, search, description, title]);
}
