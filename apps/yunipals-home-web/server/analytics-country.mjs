// Vercel supplies this header from the request IP. Return only the country;
// never echo request headers, an IP address, a city or precise coordinates.
export function analyticsCountryHandler(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    return response.end(JSON.stringify({ error: "Method not allowed" }));
  }
  const value = request.headers["x-vercel-ip-country"];
  const country =
    typeof value === "string" &&
    /^[A-Z]{2}$/.test(value) &&
    !["XX", "ZZ"].includes(value)
      ? value
      : null;
  response.end(JSON.stringify({ country }));
}

// The Build Output API's Node.js launcher expects a default handler export.
export default analyticsCountryHandler;
