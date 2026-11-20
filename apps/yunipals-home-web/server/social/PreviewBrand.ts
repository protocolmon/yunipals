import { createElement as el } from "react";

export function PreviewBrand({ logo }: { logo: string }) {
  return el(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 12 } },
    el("img", { src: logo, width: 64, height: 64, alt: "Yunipals" }),
    el(
      "div",
      {
        style: {
          display: "flex",
          fontFamily: "Archivo",
          fontSize: 25,
          letterSpacing: 1,
          color: "#302343"
        }
      },
      "YUNIPALS"
    )
  );
}
