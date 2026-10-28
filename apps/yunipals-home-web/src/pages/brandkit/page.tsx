import { ArrowDown, ArrowDownToLine, Check, Copy } from "lucide-react";
import { useState } from "react";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { cn } from "@/lib/utils";

const downloadClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-line/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4";

const colors = [
  { name: "Lavender", hex: "#C7C9F9", className: "bg-lavender" },
  { name: "Sky", hex: "#B3E7F5", className: "bg-sky" },
  { name: "Mint", hex: "#CDF6CF", className: "bg-mint" },
  { name: "Grape", hex: "#7E22CE", className: "bg-grape" },
  { name: "Ink", hex: "#0D1526", className: "bg-ink" },
  { name: "White", hex: "#FFFFFF", className: "bg-white" }
];

const artwork = [
  { name: "Ethereum", file: "yunipals-ethereum-banner.webp" },
  { name: "Base", file: "yunipals-base-banner.webp" },
  { name: "Polygon", file: "yunipals-polygon-banner.webp" },
  { name: "BNB Chain", file: "yunipals-bnb-banner-v2.webp" },
  { name: "Islands", file: "yunipals-islands-banner.webp" }
];

export function BrandkitPage() {
  usePageMetadata(
    "Brandkit | Yunipals",
    "Download Yunipals logos, collection artwork, and social assets. Explore the brand colors, typography, and design guidance."
  );
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  async function copyColor(name: string, hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedColor(hex);
      setCopyMessage(`${name} ${hex} copied to clipboard.`);
    } catch {
      setCopiedColor(null);
      setCopyMessage(`Copy this ${name} color code manually: ${hex}`);
    }
  }

  return (
    <main>
      <section className="overflow-hidden border-b border-line bg-hero-lav">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink/70">
              A growing universe of collectible Yunis
            </p>
            <h1 className="display mt-5 text-5xl text-ink sm:text-7xl">
              The Yunipals
              <br />
              brandkit.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted sm:text-lg">
              A little Yuni goes a long way. Find our logos, artwork, colors,
              and type for your next community creation.
            </p>
            <a
              href="/images/brandkit/yunipals-brandkit.zip"
              download="yunipals-brandkit.zip"
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3.5 text-sm font-bold text-white shadow-cta transition hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              <ArrowDownToLine aria-hidden="true" size={18} />
              Download the brandkit
            </a>
            <p className="mt-3 text-xs font-medium text-muted">
              ZIP · Logos, five collection banners & social artwork
            </p>
          </div>
          <div className="flex justify-center px-6 py-6" aria-hidden="true">
            <div className="flex w-full max-w-sm -rotate-3 flex-col items-center rounded-card border border-white bg-white/80 px-8 py-10 shadow-card sm:py-12">
              <img
                src="/images/yunipals-logo.webp"
                alt=""
                width={192}
                height={192}
                className="h-40 w-40 sm:h-48 sm:w-48"
              />
              <p className="display mt-6 text-4xl text-ink">Yunipals</p>
              <p className="mt-3 text-xs font-bold uppercase tracking-widest text-muted">
                Small horns. Big personality.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:pb-24">
        <nav
          aria-label="Brandkit sections"
          className="flex flex-wrap gap-x-6 gap-y-3 border-b border-line py-6"
        >
          {[
            { label: "Logos & artwork", id: "brand-assets" },
            { label: "Colors", id: "brand-colors" },
            { label: "Typography", id: "brand-typography" },
            { label: "Design guidance", id: "brand-guidance" }
          ].map(({ label, id }) => (
            <a
              key={id}
              href={`#${id}`}
              className="inline-flex items-center gap-2 rounded-lg text-sm font-bold text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
            >
              {label}
              <ArrowDown aria-hidden="true" size={14} />
            </a>
          ))}
        </nav>

        <section
          id="brand-assets"
          aria-labelledby="assets-title"
          className="scroll-mt-28 pt-14 sm:pt-20"
        >
          <p className="text-xs font-extrabold uppercase tracking-widest text-badge">
            01 / The essentials
          </p>
          <h2 id="assets-title" className="display mt-3 text-3xl sm:text-4xl">
            Logos & artwork
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            Start with the originals. Download individual assets below, or grab
            everything in the brandkit above.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <article className="overflow-hidden rounded-card border border-line">
              <div className="flex aspect-[1200/630] w-full items-center justify-center bg-lavender/30 p-6">
                <img
                  src="/images/yunipals-logo.webp"
                  alt="Yunipals logo: a horned yellow Yuni on a pink circle"
                  width={192}
                  height={192}
                  loading="lazy"
                  className="h-24 w-24 sm:h-32 sm:w-32"
                />
              </div>
              <div className="p-5 sm:p-6">
                <h3 className="text-lg font-extrabold">Yunipals logo</h3>
                <p className="mt-1 text-sm text-muted">
                  192 × 192 · Transparent background
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    href="/images/yunipals-logo.webp"
                    download="yunipals-logo.webp"
                    className={downloadClass}
                  >
                    <ArrowDownToLine aria-hidden="true" size={16} />
                    WebP<span className="sr-only"> logo</span>
                  </a>
                  <a
                    href="/images/brandkit/yunipals-logo.png"
                    download="yunipals-logo.png"
                    className={downloadClass}
                  >
                    <ArrowDownToLine aria-hidden="true" size={16} />
                    PNG<span className="sr-only"> logo</span>
                  </a>
                </div>
              </div>
            </article>
            <article className="overflow-hidden rounded-card border border-line">
              <img
                src="/images/yunipals-social-card.jpg"
                alt="Bitcoin Unidragon and three Yunis in a fantasy grassland"
                width={1200}
                height={630}
                loading="lazy"
                className="aspect-[1200/630] w-full object-contain"
              />
              <div className="p-5 sm:p-6">
                <h3 className="text-lg font-extrabold">Social artwork</h3>
                <p className="mt-1 text-sm text-muted">1200 × 630 · JPG</p>
                <a
                  href="/images/yunipals-social-card.jpg"
                  download="yunipals-social-card.jpg"
                  className={cn(downloadClass, "mt-5")}
                >
                  <ArrowDownToLine aria-hidden="true" size={16} />
                  Download<span className="sr-only"> social artwork</span>
                </a>
              </div>
            </article>
          </div>

          <h3 className="mt-10 text-xl font-extrabold">Collection banners</h3>
          <p className="mt-2 text-sm text-muted">
            A different corner of the Yuni universe. Each banner is 1920 × 823
            in WebP format.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {artwork.map(({ name, file }) => (
              <article
                key={file}
                className="overflow-hidden rounded-card border border-line"
              >
                <img
                  src={`/images/${file}`}
                  alt={`Yunipals ${name} collection artwork`}
                  width={1920}
                  height={823}
                  loading="lazy"
                  className="aspect-[1920/823] w-full object-contain"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <h4 className="font-extrabold">{name}</h4>
                  <a
                    href={`/images/${file}`}
                    download={file}
                    className={downloadClass}
                  >
                    <ArrowDownToLine aria-hidden="true" size={16} />
                    <span className="sr-only">Download {name} banner</span>
                    <span aria-hidden="true">WebP</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="brand-colors"
          aria-labelledby="colors-title"
          className="mt-14 scroll-mt-28 border-t border-line pt-14 sm:mt-20 sm:pt-20"
        >
          <p className="text-xs font-extrabold uppercase tracking-widest text-badge">
            02 / A familiar palette
          </p>
          <h2 id="colors-title" className="display mt-3 text-3xl sm:text-4xl">
            A splash of Yuni
          </h2>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted">
            Soft backgrounds, bold accents, and plenty of room to breathe. These
            are the colors used across our website. Select a swatch to copy its
            hex code.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {colors.map(({ name, hex, className }) => (
              <button
                key={hex}
                type="button"
                aria-label={`Copy ${name} color ${hex}`}
                onClick={() => void copyColor(name, hex)}
                className="overflow-hidden rounded-card border border-line text-left transition hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
              >
                <span
                  aria-hidden="true"
                  className={cn("block h-28 border-b border-line", className)}
                />
                <span className="block p-4">
                  <span className="block text-sm font-extrabold">{name}</span>
                  <span className="mt-2 flex items-center justify-between gap-1 font-mono text-xs text-muted">
                    {hex}
                    {copiedColor === hex ? (
                      <Check aria-hidden="true" size={14} />
                    ) : (
                      <Copy aria-hidden="true" size={14} />
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-3 min-h-5 text-sm font-semibold text-muted"
          >
            {copyMessage}
          </p>
        </section>

        <section
          id="brand-typography"
          aria-labelledby="typography-title"
          className="mt-10 scroll-mt-28 border-t border-line pt-14 sm:mt-16 sm:pt-20"
        >
          <p className="text-xs font-extrabold uppercase tracking-widest text-badge">
            03 / Words with personality
          </p>
          <h2
            id="typography-title"
            className="display mt-3 text-3xl sm:text-4xl"
          >
            Our type
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <article className="rounded-card bg-lavender/30 p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">
                Headlines / Archivo Black
              </p>
              <p className="display mt-8 text-4xl sm:text-5xl">
                Meet your
                <br />
                next Yuni.
              </p>
              <p className="mt-6 text-sm leading-relaxed text-muted">
                Big, bold, and uppercase. Use Archivo Black for short headlines
                and the Yunipals name.
              </p>
            </article>
            <article className="rounded-card bg-sky/25 p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">
                Body & interface / Inter
              </p>
              <p className="mt-8 text-3xl font-semibold leading-tight sm:text-4xl">
                A growing universe.
                <br />A story of your own.
              </p>
              <p className="mt-6 text-sm leading-relaxed text-muted">
                Clear, friendly, and easy to read. Use Inter for descriptions,
                labels, and everything in between.
              </p>
            </article>
          </div>
        </section>

        <section
          id="brand-guidance"
          aria-labelledby="guidance-title"
          className="mt-14 scroll-mt-28 border-t border-line pt-14 sm:mt-20 sm:pt-20"
        >
          <p className="text-xs font-extrabold uppercase tracking-widest text-badge">
            04 / Keep it recognizable
          </p>
          <h2 id="guidance-title" className="display mt-3 text-3xl sm:text-4xl">
            A few design pointers
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              {
                title: "Give the logo space",
                text: "Keep a little breathing room around the mark. Choose a simple background so the Yuni stays easy to recognize."
              },
              {
                title: "Keep the originals intact",
                text: "Preserve the logo’s proportions and colors. Scale artwork evenly and keep the characters visible when placing banners."
              },
              {
                title: "Write it Yunipals",
                text: "One word, with a capital Y. Keep the tone playful, welcoming, and clear, just like the universe we’re building."
              }
            ].map(({ title, text }) => (
              <div key={title}>
                <h3 className="text-base font-extrabold">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {text}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
