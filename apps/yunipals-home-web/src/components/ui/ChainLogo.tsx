import type { DisplayChainId } from "@/data/chains";

type ChainLogoProps = {
  chainId: DisplayChainId;
  className?: string;
};

function BaseLogo({ className }: Pick<ChainLogoProps, "className">) {
  return (
    <svg
      viewBox="0 0 1280 1280"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M0 101.12c0-34.64 0-51.95 6.53-65.28C12.78 23.08 23.09 12.77 35.85 6.52 49.17 0 66.48 0 101.12 0h1077.76c34.63 0 51.96 0 65.28 6.53 12.75 6.25 23.06 16.56 29.32 29.32 6.52 13.32 6.52 30.64 6.52 65.28v1077.76c0 34.63 0 51.96-6.52 65.28-6.26 12.75-16.57 23.06-29.32 29.32-13.32 6.52-30.65 6.52-65.28 6.52H101.12c-34.64 0-51.95 0-65.28-6.52-12.76-6.26-23.07-16.57-29.32-29.32C0 1230.85 0 1213.52 0 1178.89V101.12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EthereumLogo({ className }: Pick<ChainLogoProps, "className">) {
  return (
    <svg
      viewBox="0 0 256 417"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        opacity="0.6"
        d="M127.9 0 124.5 11.6v272.8l3.4 3.4 127.9-75.6z"
      />
      <path fill="currentColor" d="M127.9 0 0 212.2l127.9 75.6V154.1z" />
      <path
        fill="currentColor"
        opacity="0.6"
        d="m127.9 312 125.9-74.4-125.9 177.5z"
      />
      <path fill="currentColor" d="M127.9 415.1V312L0 237.6z" />
      <path
        fill="currentColor"
        opacity="0.2"
        d="m127.9 287.8 127.9-75.6-127.9-58.1z"
      />
      <path fill="currentColor" opacity="0.6" d="m0 212.2 127.9 75.6V154.1z" />
    </svg>
  );
}

function PolygonLogo({ className }: Pick<ChainLogoProps, "className">) {
  return (
    <svg
      viewBox="0 0 24.3 24.3"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="m17.41 1.224-6.815 3.914v12.216l-3.76 2.18-3.784-2.182V12.99l3.784-2.16 2.432 1.41V8.713L6.813 7.319 0 11.278v7.83l6.836 3.937 6.814-3.937V6.893l3.783-2.181 3.782 2.181v4.342l-3.782 2.201-2.454-1.423v3.511l2.431 1.402 6.881-3.914V5.138L17.41 1.224Z"
      />
    </svg>
  );
}

function BnbLogo({ className }: Pick<ChainLogoProps, "className">) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M6.04 7.04 12 1.08l5.96 5.96-2.18 2.18L12 5.44 8.22 9.22 6.04 7.04ZM1.08 12l2.18-2.18L5.44 12l-2.18 2.18L1.08 12Zm4.96 4.96 2.18-2.18L12 18.56l3.78-3.78 2.18 2.18L12 22.92l-5.96-5.96ZM18.56 12l2.18-2.18L22.92 12l-2.18 2.18L18.56 12Zm-8.8 0L12 9.76 14.24 12 12 14.24 9.76 12Z"
      />
    </svg>
  );
}

export function ChainLogo({ chainId, className }: ChainLogoProps) {
  if (chainId === "solana") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 3h18l-4 4H1l4-4Zm-4 7h18l4 4H5l-4-4Zm4 7h18l-4 4H1l4-4Z"
        />
      </svg>
    );
  }
  if (chainId === "base") {
    return <BaseLogo className={className} />;
  }

  if (chainId === "polygon") {
    return <PolygonLogo className={className} />;
  }

  if (chainId === "bnb") {
    return <BnbLogo className={className} />;
  }

  return <EthereumLogo className={className} />;
}
