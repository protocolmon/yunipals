import { Link } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { tradingTermsVersion } from "@/lib/marketplace/tradingInformation";

const sectionClass = "space-y-3";

export function TermsPage() {
  usePageMetadata(
    "Terms of Use | Yunipals",
    "Terms for Yunipals collection tools and optional buying and selling features."
  );

  return (
    <main className="mx-auto min-h-[65vh] max-w-3xl px-5 py-12 sm:px-8">
      <Link to="/" className="text-sm font-bold text-ethereum">
        Back to collection
      </Link>
      <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-badge">
        Terms of Use
      </p>
      <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">
        Yunipals Terms of Use
      </h1>
      <p className="mt-3 text-sm text-muted">Version {tradingTermsVersion}</p>

      <div className="mt-10 space-y-9 text-sm leading-relaxed text-ink/80 sm:text-base">
        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">1. These terms</h2>
          <p>
            These Terms govern your use of the Yunipals website, collection
            tools and trading interface. You must accept them before using a
            trading feature. If you do not agree, you may continue browsing but
            must not trade through Yunipals.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">2. What Yunipals does</h2>
          <p>
            Yunipals is an independent interface for exploring and managing
            Yunipals NFTs, with integrated access to third-party trading
            services and public blockchain protocols.
          </p>
          <p>
            Yunipals uses OpenSea services for buying and selling on Ethereum,
            Base and Polygon. Sellers publish BNB Chain orders in on-chain
            Seaport validation transactions, which Yunipals indexes.
            Transactions settle through Seaport smart contracts. Yunipals is
            not OpenSea and is not endorsed by or affiliated with OpenSea.
          </p>
          <p>
            OpenSea, wallet providers, blockchain networks and other third
            parties operate under their own terms. Your use of OpenSea services
            is also subject to the{" "}
            <a
              href="https://opensea.io/tos"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ethereum underline underline-offset-4"
            >
              OpenSea Terms of Service
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">3. Eligibility</h2>
          <p>
            You must be at least 18 years old, legally capable of entering into
            binding agreements, and the owner of the connected wallet or
            authorized to act for its owner.
          </p>
          <p>
            You must not use a trading feature where doing so would violate
            applicable law or sanctions. You must not use Yunipals if you are a
            sanctioned person, are acting for a sanctioned person, or are
            located or ordinarily resident in a jurisdiction where the relevant
            service is prohibited. You must not evade access restrictions or
            provide false eligibility information.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            4. Wallets and transactions
          </h2>
          <p>
            You retain control of your wallet and authorize transactions
            yourself. Yunipals does not hold your private keys or take custody
            of customer funds or NFTs. Keep your wallet credentials and recovery
            phrase secure; never share them to use Yunipals.
          </p>
          <p>
            Token approvals authorize smart contracts to transfer assets within
            the permissions you grant. Review the contract, token and approval
            scope before signing. Approvals can remain active until revoked;
            cancelling an order does not necessarily revoke its approvals.
          </p>
          <p>
            Review the NFT, network, currency, amount, recipients, fees and
            expiry before signing. Blockchain transactions generally cannot be
            reversed by Yunipals. Network fees may be charged even when a
            transaction fails.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            5. Listings, offers and cancellations
          </h2>
          <p>
            You may list only an NFT you own or are authorized to sell. A signed
            listing or offer may be accepted while it remains valid. Closing the
            website, disconnecting your wallet or deleting local browser data
            does not cancel a signed order.
          </p>
          <p>
            Cancellation may require a separate blockchain transaction and a
            network fee. An order may be filled before its cancellation is
            confirmed. Expiration does not reverse a completed trade.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">6. Prices and fees</h2>
          <p>
            Order reviews show payment amounts, seller proceeds and the amounts
            and recipient addresses of order fees. Marketplace or creator fees,
            where applicable, are included in the reviewed order total. Fees can
            vary between chains and orders. Non-custodial operation does not
            mean trading is free of fees.
          </p>
          <p>
            Displayed amounts may be rounded. The transaction review and your
            wallet show the amounts you authorize. Network fees are additional
            and can change. You are responsible for determining and meeting your
            tax obligations.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">7. Risks</h2>
          <p>
            NFTs and cryptocurrencies are volatile and may lose all value.
            Yunipals does not promise profit, resale opportunity or liquidity
            and does not provide personalized investment advice. Rarity scores,
            rankings and collection statistics are informational, not
            recommendations to buy or sell.
          </p>
          <p>
            Risks include wallet compromise, incorrect approvals, malicious or
            defective smart contracts, network congestion, forks, third-party
            outages and inaccurate or delayed listing, ownership, price or
            ranking data. A displayed order is not a guarantee that it remains
            available or can be filled.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            8. NFTs and intellectual property
          </h2>
          <p>
            Acquiring an NFT transfers the token and only those additional
            rights expressly granted under its applicable license. It does not
            automatically transfer copyright, trademark rights or unrestricted
            commercial rights in associated artwork.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">9. Prohibited conduct</h2>
          <p>
            Do not use Yunipals for fraud, theft, sanctions evasion, money
            laundering, deceptive trading, market manipulation, infringement or
            unlawful content. Do not compromise wallets, exploit
            vulnerabilities, interfere with the service, scrape it in a harmful
            manner or bypass access, security or rate controls.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            10. Availability and restrictions
          </h2>
          <p>
            Yunipals may modify, suspend or restrict relevant features where
            reasonably necessary for security, maintenance, legal compliance or
            a material breach of these Terms. Website restrictions do not
            themselves cancel signed orders or change blockchain ownership.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            11. Responsibility and legal rights
          </h2>
          <p>
            Yunipals does not guarantee uninterrupted or error-free operation.
            Your responsibility for wallet security and transaction review does
            not excuse Yunipals from responsibilities imposed by law.
          </p>
          <p>
            Nothing in these Terms excludes liability that cannot lawfully be
            excluded or limits mandatory consumer rights. Technical inability to
            reverse a blockchain transaction does not remove a legal remedy you
            may otherwise have.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">12. Changes</h2>
          <p>
            Material changes will be identified by a new version. Yunipals may
            require renewed acceptance before further trading. Changes do not
            retrospectively alter completed blockchain transactions.
          </p>
        </section>
      </div>
    </main>
  );
}
