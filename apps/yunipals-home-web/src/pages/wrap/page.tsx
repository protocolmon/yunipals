import { Link } from "react-router-dom";
import { isAddress } from "viem";

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
  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-4 py-12 sm:py-16">
      <Link to="/boosters" className="text-sm font-bold text-grape underline">
        Back to packs
      </Link>
      <header className="mb-8 mt-6">
        <p className="mb-3 text-sm font-bold uppercase tracking-widest text-grape">
          On Base
        </p>
        <h1 className="font-display text-3xl text-ink sm:text-4xl">
          Wrap PMON to YPAL
        </h1>
      </header>
      {isConfirmedYpalWrapDeployment(deployment) ? (
        <BoosterYpalWrap deployment={deployment} />
      ) : (
        <p className="rounded-card border border-line bg-white p-6 text-muted">
          YPAL wrapping is temporarily unavailable. Please try again shortly.
        </p>
      )}
    </main>
  );
}
