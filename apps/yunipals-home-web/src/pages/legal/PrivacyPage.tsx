import { Link } from "react-router-dom";

import { usePageMetadata } from "@/hooks/usePageMetadata";
import { environment } from "@/environment";
import { useAnalyticsConsent } from "@/providers/AnalyticsConsentProvider";

const sectionClass = "space-y-3";

export function PrivacyPage() {
  const { openSettings } = useAnalyticsConsent();
  const config = environment.analytics;
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
      <p className="mt-3 text-sm text-muted">Last updated October 8, 2026</p>

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
          <p>
            We remember your analytics preference for 180 days. If you allow
            analytics, we store a random browser identifier and local records
            used to avoid counting the same trading action twice. These records
            expire with your preference and are removed when you turn analytics
            off. They do not cancel or change trading records.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className="display text-2xl text-ink">
            Optional analytics with Mixpanel
          </h2>
          <p>
            With your permission, Yunipals uses Mixpanel to understand how
            visitors browse collections and use wallet and trading features. We
            send selected interaction events, a broad device category, event
            times and a randomly generated browser identifier. This information
            is pseudonymous and can connect activity from the same browser.
          </p>
          <p>
            We exclude wallet addresses, ENS names, signatures, transaction and
            order hashes, search text, full page URLs and raw error messages
            from analytics events. We do not record browsing sessions or
            automatically capture clicks. IP-derived geolocation is disabled,
            although Mixpanel receives your IP address when your browser
            connects to its servers.
          </p>
          <p>
            Analytics starts only after you select Allow analytics. Declining it
            does not restrict browsing, wallet connections or trading. We also
            respect supported Do Not Track and Global Privacy Control signals.
            Trading-term acceptance is separate from analytics permission.
          </p>
          <p>
            {config.enabled
              ? `This deployment sends analytics to Mixpanel’s ${config.region === "eu" ? "European Union" : config.region === "india" ? "India" : "United States"} servers under our applicable data-processing arrangements.`
              : "Optional analytics is currently disabled on this deployment."}
          </p>
          {config.enabled && config.retention && (
            <p>
              Analytics events are retained for {config.retention.value}{" "}
              {config.retention.value === 1
                ? config.retention.unit.slice(0, -1)
                : config.retention.unit}{" "}
              under the Mixpanel project policy.
            </p>
          )}
          <p>
            You can change your choice at any time. Turning analytics off stops
            new collection and removes analytics identifiers and local
            deduplication records. Requests already sent and previously
            collected events are not automatically deleted.
          </p>
          <button
            type="button"
            onClick={openSettings}
            className="rounded-full border border-line px-5 py-3 text-sm font-bold text-ink hover:bg-line/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-badge focus-visible:ring-offset-4"
          >
            Analytics settings
          </button>
          {config.privacyEmail && (
            <p>
              For privacy requests, including access to or deletion of analytics
              information, contact{" "}
              <a
                href={`mailto:${config.privacyEmail}`}
                className="underline underline-offset-4"
              >
                {config.privacyEmail}
              </a>
              . We may need your random analytics identifier to locate
              browser-specific information. You can find it in Analytics
              settings while analytics is enabled. Wallet addresses are not used
              to identify analytics records.
            </p>
          )}
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
          <p>
            If you allow optional analytics, Mixpanel processes the selected
            event information on our behalf. Read{" "}
            <a
              href="https://mixpanel.com/legal/privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Mixpanel’s privacy policy
              <span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            for information about its practices.
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
