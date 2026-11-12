import {
  portalScoreCategories,
  validatePortalScores,
  type PortalScores
} from "./portals";

export interface PortalSlabTheme {
  id: string;
  name: string;
  accent: string;
  foil: readonly string[];
  paper: readonly [string, string, string];
}

export const portalSlabThemes: Readonly<Record<string, PortalSlabTheme>> = {
  "1": {
    id: "rainbow-slab-v1",
    name: "Rainbow Portal",
    accent: "#6337a9",
    foil: ["#ff9fbc", "#ffdf83", "#a4e6b8", "#83dcf1", "#b0a0f4", "#eba6e6"],
    paper: ["#f8f1ff", "#edfff9", "#fff7dd"]
  }
};

const neutralTheme: PortalSlabTheme = {
  id: "classic-slab-v1",
  name: "Portal",
  accent: "#484563",
  foil: ["#e2e5f0", "#b6c6db", "#f2eaf7"],
  paper: ["#f4f4fc", "#eef6fa", "#faf8f4"]
};

export interface PortalSlabInput {
  kindId: string;
  imageURI: string;
  title: string;
  scores: PortalScores;
  tokenId?: string;
  version?: string;
  previewLabel?: string;
  portalName?: string;
}

const xml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;"
        })[character]!
    );

function rasterURI(value: string) {
  if (/^\/images\/[a-zA-Z0-9/_%.+-]+$/.test(value) && !value.includes(".."))
    return value;
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))
    return value;
  try {
    const url = new URL(value);
    if (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      return url.href;
  } catch {
    /* Reject malformed or active image references. */
  }
  throw new Error(
    "A slab requires a raster image data URI or approved web image URL."
  );
}

function titleLines(value: string) {
  const words = value.replace(/\s+/g, " ").trim().slice(0, 200).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length <= 27)
      line = (line + " " + word).trim();
    else {
      lines.push(line || word.slice(0, 27));
      line = line ? word : "";
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && line) lines.push(line);
  if (lines.join(" ").length < value.trim().length && lines.length) {
    lines[lines.length - 1] =
      lines[lines.length - 1].slice(0, 25).replace(/[\s.,;:]+$/, "") + "…";
  }
  return lines.length ? lines : ["Portal transformation"];
}

/** Deterministic presentation; never changes the artwork, scores or AI input. */
export function renderPortalSlab(input: PortalSlabInput): string {
  validatePortalScores(input.scores);
  if (
    !/^[1-9][0-9]*$/.test(input.kindId) ||
    (input.tokenId !== undefined && !/^[1-9][0-9]*$/.test(input.tokenId)) ||
    (input.version !== undefined && !/^[0-9]+$/.test(input.version))
  )
    throw new Error("Invalid slab identity.");
  const theme = portalSlabThemes[input.kindId] ?? neutralTheme;
  const portalName = input.portalName ?? theme.name;
  const image = xml(rasterURI(input.imageURI));
  const average = (
    portalScoreCategories.reduce((sum, key) => sum + input.scores[key], 0) / 4
  ).toFixed(1);
  const identifier = input.tokenId
    ? `NFT #${input.tokenId}${input.version ? ` · ART V${input.version}` : ""}`
    : (input.previewLabel ?? "PREVIEW STUDY");
  const lines = titleLines(input.title);
  const stops = theme.foil
    .map(
      (color, i) =>
        `<stop offset="${(i * 100) / (theme.foil.length - 1)}%" stop-color="${color}"/>`
    )
    .join("");
  const label = xml(
    `${portalName}, ${input.title}, ${identifier}, overall ${average} out of 100. ${portalScoreCategories.map((key) => `${key} ${input.scores[key]}`).join(", ")}.`
  );
  const id = `slab-${input.kindId}-${input.tokenId ?? "preview"}-${input.version ?? "1"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 720 1360" width="720" height="1360" role="img" aria-labelledby="${id}-title" data-slab-theme="${theme.id}">
  <title id="${id}-title">${label}</title>
  <defs>
    <linearGradient id="${id}-edge" x2=".9" y2="1"><stop stop-color="#fbfcff"/><stop offset=".22" stop-color="#8f97ab"/><stop offset=".48" stop-color="#e5e9f6"/><stop offset=".73" stop-color="#777e94"/><stop offset="1" stop-color="#ecf1fc"/></linearGradient>
    <linearGradient id="${id}-glass" x2="1" y2="1"><stop stop-color="#ecedfa"/><stop offset=".45" stop-color="#d4d7e7"/><stop offset="1" stop-color="#dce5ec"/></linearGradient>
    <linearGradient id="${id}-rainbow" x2="1" y2=".7">${stops}</linearGradient>
    <linearGradient id="${id}-paper" x2="1" y2="1"><stop stop-color="${theme.paper[0]}"/><stop offset=".53" stop-color="${theme.paper[1]}"/><stop offset="1" stop-color="${theme.paper[2]}"/></linearGradient>
    <linearGradient id="${id}-shine" x2="1" y2=".9"><stop stop-color="#fff" stop-opacity=".8"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".24"/></linearGradient>
    <radialGradient id="${id}-well"><stop stop-color="#3f3159"/><stop offset="1" stop-color="#191725"/></radialGradient>
    <filter id="${id}-shadow" x="-12%" y="-8%" width="124%" height="120%"><feDropShadow dx="0" dy="9" stdDeviation="7" flood-color="#20182e" flood-opacity=".25"/></filter>
    <clipPath id="${id}-label-clip"><rect x="56" y="60" width="608" height="272" rx="24"/></clipPath>
  </defs>
  <rect x="14" y="10" width="692" height="1338" rx="78" fill="url(#${id}-edge)" stroke="#636a7e" stroke-width="3" filter="url(#${id}-shadow)"/>
  <rect x="23" y="20" width="674" height="1318" rx="69" fill="url(#${id}-glass)" stroke="#f8fbff" stroke-width="2"/>
  <rect x="34" y="31" width="652" height="1296" rx="59" fill="none" stroke="#81879b" stroke-width="3"/>
  <rect x="40" y="37" width="640" height="1284" rx="54" fill="none" stroke="url(#${id}-rainbow)" stroke-width="5"/>
  <path d="M43 110V85Q43 40 90 40H590" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".72"/>
  <path d="M680 1210v53q0 60-60 60H126" fill="none" stroke="#fff" stroke-width="3" opacity=".58"/>
  <path d="M25 146v1022M695 205v924" stroke="#fff" stroke-width="3" opacity=".4"/>
  <rect x="53" y="57" width="614" height="278" rx="28" fill="#838197" stroke="#76748b" stroke-width="2"/>
  <rect x="56" y="60" width="608" height="272" rx="24" fill="url(#${id}-paper)" stroke="#fff" stroke-width="2"/>
  <g clip-path="url(#${id}-label-clip)">
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<ellipse cx="545" cy="265" rx="${65 + i * 27}" ry="${95 + i * 25}" fill="none" stroke="url(#${id}-rainbow)" stroke-width="${i === 4 ? 3 : 1.4}" opacity=".42" transform="rotate(-30 545 265)"/>`).join("")}
    <path d="M305 60l150 272h90L395 60z" fill="#fff" opacity=".28"/>
  </g>
  <g font-family="Trebuchet MS,Arial,sans-serif" fill="#2c2341">
    <text x="82" y="108" font-size="37" font-weight="900" letter-spacing="1">YUNIPALS<tspan font-size="18" fill="${theme.accent}" dx="9">TCG</tspan></text>
    <rect x="81" y="122" width="229" height="25" rx="12.5" fill="#fff" fill-opacity=".65" stroke="url(#${id}-rainbow)" stroke-width="1.6"/>
    <text x="195" y="139" text-anchor="middle" font-size="12" font-weight="800" letter-spacing="1.7" fill="${theme.accent}">${xml(portalName.toUpperCase().slice(0, 27))}</text>
    ${lines.map((line, i) => `<text x="82" y="${181 + i * 27}" font-size="25" font-weight="800">${xml(line)}</text>`).join("")}
    <text x="82" y="239" font-size="12" font-weight="800" letter-spacing="1.2">${xml(identifier.slice(0, 52))}</text>
    <text x="570" y="111" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="2" fill="${theme.accent}">OVERALL</text>
    <text x="570" y="179" text-anchor="middle" font-size="69" font-weight="900" letter-spacing="-4">${average}</text>
    <text x="570" y="204" text-anchor="middle" font-size="13" font-weight="800" letter-spacing="1.4">GRADE / 100</text>
    <rect x="76" y="254" width="568" height="61" rx="13" fill="#fff" fill-opacity=".66" stroke="#cec9dc" stroke-opacity=".6"/>
    ${portalScoreCategories.map((category, i) => `<g text-anchor="middle"><text x="${147 + i * 142}" y="274" font-size="10" font-weight="800" letter-spacing="1.1" fill="${theme.accent}">${category.toUpperCase()}</text><text x="${147 + i * 142}" y="301" font-size="23" font-weight="900">${input.scores[category]}</text></g>`).join("")}
  </g>
  <rect x="44" y="354" width="632" height="928" rx="35" fill="url(#${id}-well)" stroke="#747488" stroke-width="3"/>
  <rect x="52" y="362" width="616" height="912" rx="29" fill="none" stroke="url(#${id}-rainbow)" stroke-width="2" opacity=".9"/>
  <image x="64" y="374" width="592" height="888" preserveAspectRatio="xMidYMid meet" href="${image}" xlink:href="${image}"/>
  <rect x="61" y="371" width="598" height="894" rx="17" fill="none" stroke="#fff" stroke-opacity=".28"/>
  <path d="M48 420v-35q0-27 27-27h220" fill="none" stroke="#fff" stroke-width="2" opacity=".56"/>
  <path d="M61 101v218M660 71v159" stroke="url(#${id}-shine)" stroke-width="4" stroke-linecap="round"/>
  <g transform="translate(360 1307)"><circle r="15" fill="url(#${id}-rainbow)" stroke="#fff" stroke-width="1.5"/><path d="M0-10L8 0 0 10-8 0Z" fill="#fff" fill-opacity=".75"/><path d="M0-8V8M-6 0H6" stroke="${theme.accent}" stroke-width="1.1"/></g>
  <g font-family="Trebuchet MS,Arial,sans-serif" font-size="9" font-weight="800" letter-spacing="2" fill="#5f5875"><text x="78" y="1310">YUNIPALS GRADED</text><text x="642" y="1310" text-anchor="end">${xml(portalName.toUpperCase().slice(0, 22))}</text></g>
  </svg>`;
}
