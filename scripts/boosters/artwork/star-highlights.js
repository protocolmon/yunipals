"use strict";

// Centers and glow radii traced from the stars already painted in each 1024×1536
// print. Match the exact artwork hash so revisions cannot inherit a stale map.
// The mask relights a copy of the original pixels; it draws no new stars.
const ART_STAR_MAPS = {
  bcf6f10ddcc7154be43b8bbb7ba5df0943d9724e9766cfae545259e1fbb47fd4: [
    [120, 300, 30], [244, 294, 22], [366, 313, 36], [662, 335, 50],
    [248, 393, 40], [140, 494, 58], [682, 610, 54], [757, 714, 30],
    [609, 781, 38], [268, 798, 38], [815, 837, 46], [191, 951, 32],
    [284, 1102, 32], [909, 968, 27], [738, 1230, 24], [903, 1231, 30]
  ],
  "12debb3d7173ce8b9cdb02728309c0b8733ef2783bb9c6465a09b579fcdf39fe": [
    [367, 326, 44], [818, 340, 65], [557, 391, 40], [214, 439, 50],
    [720, 505, 38], [878, 511, 38], [784, 574, 34], [842, 568, 40],
    [177, 668, 38], [704, 734, 44], [129, 892, 46], [909, 895, 46],
    [530, 299, 22], [642, 323, 30], [309, 776, 27]
  ]
};

function setArtworkStars(container, candidate, image) {
  const stage = Object.values(candidate.stages).find((result) => result.path === image);
  const points = candidate.traits.glitter === "Yes" ? ART_STAR_MAPS[stage?.sha256] : null;
  container.hidden = !points;
  container.dataset.starCount = String(points?.length || 0);
  container.style.removeProperty("--star-mask");
  const print = container.querySelector("img");
  print.removeAttribute("src");
  if (!points) return;
  const circles = points.map(([x, y, radius]) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="url(#bloom)"/>`).join("");
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536"><defs><radialGradient id="bloom"><stop stop-color="white"/><stop offset=".28" stop-color="white" stop-opacity=".95"/><stop offset=".65" stop-color="white" stop-opacity=".4"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>${circles}</svg>`;
  container.style.setProperty("--star-mask", `url("data:image/svg+xml,${encodeURIComponent(mask)}")`);
  print.src = image;
}

// Reviewed clarity proofs preserve the approved prints' painted star positions.
ART_STAR_MAPS.b93732d33fa04a36fa7b8450c61ddef4d686021945da6e4e2c5aeafc13d7434d = ART_STAR_MAPS.bcf6f10ddcc7154be43b8bbb7ba5df0943d9724e9766cfae545259e1fbb47fd4;
ART_STAR_MAPS["0156cc2a608cf55c63cbb6b71d3910e295c353bd6d8f712992e0ec6269fcb476"] = ART_STAR_MAPS["12debb3d7173ce8b9cdb02728309c0b8733ef2783bb9c6465a09b579fcdf39fe"];

// Locked-design sample maps: only stars painted in these exact prints.
ART_STAR_MAPS["8291306e07d3c61c4ee3548347a23acac03f8d601d8874710f28b575d8e51e2c"] = [
  [122,299,30],[244,294,22],[384,313,35],[661,335,45],[250,391,38],
  [141,494,56],[910,445,26],[682,610,50],[752,714,27],[680,794,30],
  [925,950,27],[803,1100,36],[302,1127,30],[149,818,24]
];
ART_STAR_MAPS["51c691c2453ee5795b65f675468528a1057f6a1bbfa9a92f05ea3a5b2a4735a9"] = [
  [120,298,30],[244,293,22],[367,314,38],[662,333,46],[415,358,28],
  [708,377,25],[248,391,34],[143,495,56],[910,446,28],[910,611,39],
  [235,866,29],[245,955,34],[910,982,35],[829,1036,33],[814,1145,26]
];

// OG palette correction keeps the source composition; calibrated visually.
ART_STAR_MAPS["1743944f588483c30ee86c178c48efe1ba83ec10a21a533ddae1bc08dd416634"] = ART_STAR_MAPS["8291306e07d3c61c4ee3548347a23acac03f8d601d8874710f28b575d8e51e2c"];

// Full OG colorway edit preserves source geometry and star positions.
ART_STAR_MAPS["45709a6ac84f0e183a8de46cdab2a76afb0c44d2acafc033a65e248c8d6d8fdd"] = ART_STAR_MAPS["8291306e07d3c61c4ee3548347a23acac03f8d601d8874710f28b575d8e51e2c"];
