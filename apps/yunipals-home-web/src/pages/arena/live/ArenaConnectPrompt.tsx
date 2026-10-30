import { Wallet } from "lucide-react";
import { WalletCollectionButton } from "@/components/WalletCollectionButton";

export function ArenaConnectPrompt({ description }: { description: string }) {
  return (
    <section className="rounded-card border border-line bg-panel-ethereum px-6 py-12 text-center">
      <Wallet size={28} aria-hidden="true" className="mx-auto text-grape" />
      <h2 className="mt-4 text-xl font-bold">Your wallet, your Arena</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-6 flex justify-center">
        <WalletCollectionButton />
      </div>
    </section>
  );
}
