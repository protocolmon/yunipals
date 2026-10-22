import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const DEFAULT_DESCRIPTION =
  "Explore Yunipals across Ethereum, Base, Polygon, and BNB Chain. Discover traits, rarity, token histories, and collector profiles.";
export const DEFAULT_TITLE = "Yunipals — Explore the Collection";
const SITE_URL = "https://www.yunipals.com";

function setMetadata(title: string, description: string, pathname: string) {
  document.title = title;
  const canonical = `${SITE_URL}${pathname === "/collection" ? "/" : pathname}`;
  for (const [selector, content] of [
    ['meta[name="description"]', description],
    ['meta[property="og:title"]', title],
    ['meta[property="og:description"]', description],
    ['meta[property="og:url"]', canonical],
    ['meta[name="twitter:title"]', title],
    ['meta[name="twitter:description"]', description],
    [
      'meta[name="robots"]',
      pathname === "/orders" || pathname.startsWith("/orders/")
        ? "noindex, follow"
        : "index, follow"
    ]
  ]) {
    document.querySelector(selector)?.setAttribute("content", content);
  }
  document
    .querySelector('link[rel="canonical"]')
    ?.setAttribute("href", canonical);
}

export function usePageMetadata(
  title: string,
  description = DEFAULT_DESCRIPTION
) {
  const { pathname, search } = useLocation();
  const canonicalPath =
    pathname === "/leaderboard" &&
    new URLSearchParams(search).get("chain") === "solana"
      ? "/leaderboard?chain=solana"
      : pathname;
  useEffect(() => {
    setMetadata(title, description, canonicalPath);

    return () => {
      setMetadata(DEFAULT_TITLE, DEFAULT_DESCRIPTION, "/");
    };
  }, [canonicalPath, description, title]);
}
