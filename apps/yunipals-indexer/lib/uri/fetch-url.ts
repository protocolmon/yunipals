export function metadataFetchUrl(tokenUri: string) {
  const url = new URL(tokenUri);
  if (url.protocol === "https:" && url.hostname === "meta.yunipals.com") {
    url.hostname = "meta.polkamon.com";
  }
  return url.toString();
}
