import { useState } from "react";
import { Link } from "react-router-dom";
import { isAddress } from "viem";
import { ArrowLeft, ArrowRight, Check, Copy, Sparkles } from "lucide-react";

import { environment } from "@/environment";
import {
  isConfirmedYpalWrapDeployment,
  type YpalWrapDeployment
} from "@/lib/ypalWrap";
import { BoosterYpalWrap } from "@/pages/boosters/BoosterYpalWrap";

const deployment: YpalWrapDeployment | null =
  environment.boostersEnabled &&
  environment.boosterLaunchId === "base-ypal-v1" &&
  isAddress(environment.boosterPaymentToken) &&
  isAddress(environment.boosterPmon)
    ? {
        confirmed: true,
        manifestSha256: environment.boosterDeploymentSha256,
        chainId: 8453,
        ypal: environment.boosterPaymentToken,
        pmon: environment.boosterPmon
      }
    : null;

export function YpalWrapPage() {
  const [copiedToken, setCopiedToken] = useState<"PMON" | "YPAL" | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const confirmedDeployment = isConfirmedYpalWrapDeployment(deployment)
    ? deployment
    : null;

  async function copyAddress(token: "PMON" | "YPAL") {
    if (!confirmedDeployment) return;
    const address =
      token === "PMON" ? confirmedDeployment.pmon : confirmedDeployment.ypal;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedToken(token);
      setCopyMessage(`${token} contract address copied.`);
    } catch {
      setCopiedToken(null);
      setCopyMessage(
        `Could not copy. Select and copy the ${token} address manually: ${address}`
      );
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        to="/boosters"
        className="inline-flex items-center gap-2 rounded-full text-sm font-semibold text-muted transition-colors hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to packs
      </Link>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="overflow-hidden rounded-card border border-lavender/50 bg-panel-polygon">
          <header className="px-6 pb-6 pt-8 sm:px-8 sm:pt-10">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white bg-white/80 px-3 py-1.5 text-xs font-bold text-grape">
              <Sparkles size={14} aria-hidden="true" />
              YOUR NEXT PAL STARTS HERE
            </p>
            <h1 className="max-w-sm font-display text-4xl leading-tight text-ink sm:text-5xl">
              A little wrap.
              <span className="block text-grape">A new adventure.</span>
            </h1>
            <p className="mt-5 max-w-sm text-base leading-relaxed text-muted">
              Turn your PMON into YPAL, the token for opening Yunipals packs.
              Same amount. A whole world of pals to discover.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm font-bold text-ink">
              <button
                type="button"
                disabled={!confirmedDeployment}
                onClick={() => void copyAddress("PMON")}
                aria-label="Copy PMON contract address on Base"
                title={confirmedDeployment?.pmon}
                className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-60"
              >
                1 PMON
                {copiedToken === "PMON" ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
              </button>
              <ArrowRight size={18} className="text-grape" aria-hidden="true" />
              <button
                type="button"
                disabled={!confirmedDeployment}
                onClick={() => void copyAddress("YPAL")}
                aria-label="Copy YPAL contract address on Base"
                title={confirmedDeployment?.ypal}
                className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape disabled:cursor-not-allowed disabled:opacity-60"
              >
                1 YPAL
                {copiedToken === "YPAL" ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
              </button>
              <span className="text-xs font-medium text-muted">On Base</span>
            </div>
            <p role="status" className="mt-2 break-all text-xs text-muted">
              {copyMessage}
            </p>
          </header>
          <img
            src="/images/yunipals-base-banner.webp"
            alt="Four colorful Yunipals gathered in front of a glowing crystal portal"
            width={1920}
            height={823}
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
        <div className="min-w-0 space-y-4">
          {confirmedDeployment ? (
            <BoosterYpalWrap deployment={confirmedDeployment} />
          ) : (
            <p className="rounded-card border border-line bg-white p-6 text-muted">
              YPAL wrapping is temporarily unavailable. Please try again
              shortly.
            </p>
          )}
          <Link
            to="/boosters"
            className="group flex items-center gap-4 rounded-card border border-lavender/40 bg-lavender/10 p-4 transition-colors hover:bg-lavender/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          >
            <img
              src="/images/boosters/yunipals-pack-v1.png"
              alt="Yunipals booster pack"
              width={48}
              height={72}
              className="h-16 w-11 -rotate-6 rounded-lg object-cover transition-transform group-hover:rotate-0 motion-reduce:transform-none"
            />
            <div className="flex-1">
              <p className="font-bold text-ink">YPAL ready. Who’s inside?</p>
              <p className="mt-1 text-sm text-muted">
                Head to packs and meet your next pal.
              </p>
            </div>
            <ArrowRight
              size={20}
              className="shrink-0 text-grape"
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-muted">
        Wrapping happens entirely on Base. Your PMON must already be on Base;
        this does not move tokens between networks. You’ll need a little Base
        ETH for network fees.
      </p>
    </main>
  );
}
