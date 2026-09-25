import { Link } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";

const sectionClass = "space-y-3";

export function PrivacyPage() {
  usePageMetadata(
    "Privacy Notice | Yunipals",
    "How Yunipals handles information when you browse the collection, connect a wallet, or use optional trading features."
  );

  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-5 py-12 sm:px-8">
      <Link to="/" className="text-sm font-bold text-ethereum">
        Back to collection
      </Link>
      <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-badge">
        Privacy Notice
      </p>
      <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">
        How Yunipals handles information
      </h1>
      <p className="mt-3 text-sm text-muted">Last updated September 18, 2026</p>

      <div className="mt-10 space-y-9 text-sm leading-relaxed text-ink/80 sm:text-base">
        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            Information the interface uses
          </h2>
          <p>
            Yunipals uses public blockchain information such as wallet
            addresses, token ownership, orders and transaction history. When you
            connect a wallet, the interface receives the address and network
            information made available by your wallet provider.
          </p>
          <p>
            Hosting and API systems may process technical information such as IP
            address, request time, requested page, device or browser details and
            error information for security, reliability and abuse prevention.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">Browser storage</h2>
          <p>
            Yunipals stores trading-term acceptance, interface preferences,
            pending transaction references and locally saved order-recovery
            information in your browser. Clearing browser data can remove these
            records but does not cancel an order or reverse a blockchain
            transaction.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">Why information is used</h2>
          <p>
            Information is used to display collections and ownership, prepare
            and track user-requested trading actions, remember consent and
            preferences, protect the service, diagnose failures and comply with
            applicable legal obligations.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">Third parties</h2>
          <p>
            Requests may involve hosting providers, RPC providers, blockchain
            networks, wallet providers and OpenSea services. These parties may
            process information under their own privacy notices. Public
            blockchain data is generally visible permanently and cannot be
            erased by Yunipals.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            Retention and your choices
          </h2>
          <p>
            Browser records remain until they expire, are replaced or you clear
            them. Server logs are retained only as reasonably needed for
            security, operations and legal obligations. You can browse without
            connecting a wallet or accepting the trading terms.
          </p>
          <p>
            Depending on applicable law, you may have rights concerning personal
            information associated with you. Public blockchain data and
            information controlled by third parties may be outside Yunipals’
            ability to change or delete.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">Updates</h2>
          <p>
            This notice may be updated when the service or applicable
            requirements change. A revised date will be shown on this page.
          </p>
        </section>
      </div>
    </main>
  );
}
