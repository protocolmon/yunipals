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
      <p className="mt-3 text-sm text-muted">Last updated October 31, 2026</p>

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
            times and a randomly generated browser identifier. When you connect
            a wallet, we also use a stable identifier derived from that wallet
            to create a Mixpanel user profile and link consenting activity from
            the same wallet across visits, browsers and devices. The identifier
            uses a cryptographic hash of the normalized wallet address and a
            Yunipals-specific namespace. It is pseudonymous, not anonymous: it
            can be linked to a known wallet by calculating the same identifier.
            A wallet connection is not proof of a person’s identity.
          </p>
          <p>
            We exclude raw wallet addresses, ENS names, signatures, transaction
            and order hashes, search text, full page URLs and raw error messages
            from analytics events. We do not record browsing sessions or
            automatically capture clicks. After consent, we request an
            approximate country code from our hosting provider when available.
            The host infers it from your connection’s IP address; VPNs and
            proxies may make it inaccurate. We send the country code on events
            and identified user profiles, without sending a city, region,
            precise coordinates or an IP address as an analytics property.
            Mixpanel’s own IP-derived geolocation is disabled, although it
            receives your IP address when your browser connects to its servers.
          </p>
          <p>
            We measure submissions and confirmed on-chain actions initiated
            through this interface, including trades, approvals, wrapping,
            booster actions, island withdrawals and arena entries and claims.
            Confirmation events follow successful transaction receipt checks;
            reverted or cancelled actions are not counted as confirmed.
            Analytics does not monitor unrelated wallet activity or backfill
            public transaction history. Events describe the action and network
            without transaction hashes, token identifiers, amounts or
            recipients.
          </p>
          <p>
            Analytics starts only after you select Allow analytics. Declining it
            does not restrict browsing, wallet connections or trading. We also
            respect supported Do Not Track and Global Privacy Control signals.
            Trading-term acceptance is separate from analytics permission.
            Visitors who allowed our earlier browser-only analytics are asked
            again before wallet-linked profiles or country tracking starts.
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
              under the Mixpanel project policy. User profiles and identity
              links are retained until deleted; the event-retention window does
              not automatically delete a profile.
            </p>
          )}
          <p>
            You can change your choice at any time. Turning analytics off stops
            new collection and removes locally stored analytics identifiers and
            deduplication records. Previously collected events, user profiles
            and identity links are not automatically deleted. If you later allow
            analytics with the same wallet, its stable identifier can reconnect
            that activity to the existing profile. Contact us to request
            deletion.
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
              . We may need your analytics identifier to locate the information.
              Analytics settings shows your wallet-derived identifier when a
              wallet is linked, or your browser identifier otherwise. Copy it
              before turning analytics off. If you used multiple wallets or
              unlinked browsers, more than one identifier may be needed.
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
