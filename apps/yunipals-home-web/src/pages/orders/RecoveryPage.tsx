import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAddress } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";

import { chainDetails } from "@/data/chains";
import { useOrderCancellation } from "@/hooks/marketplace/useOrderCancellation";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  encodeRecoverableOrders,
  importRecoverableOrders,
  maxOrderRecoveryFileBytes,
  orderRecoveryEvent,
  readRecoverableOrders,
  recoverableOrderKey,
  type RecoverableOrder
} from "@/lib/marketplace/orderRecovery";

const button =
  "rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50";

function SavedOrder({ record }: { record: RecoverableOrder }) {
  const { state, status, cancel } = useOrderCancellation(record);
  const [review, setReview] = useState(false);
  const busy = [
    "preparing",
    "switching",
    "simulating",
    "wallet",
    "pending"
  ].includes(state.stage);
  const side = record.order.offer[0]?.itemType === 2 ? "Listing" : "Offer";
  const labels = {
    "signature-requested":
      "A signature was requested; publication is unconfirmed.",
    signed: "Signed; publication is unconfirmed.",
    "publication-unknown": "Publication could not be confirmed.",
    accepted: "The order service previously accepted this order.",
    imported: "Imported cancellation record; publication is unconfirmed."
  };
  return (
    <li className="rounded-card border border-line bg-white p-5 shadow-card">
      <p className="font-extrabold">
        {side} · {chainDetails[record.asset.chain].label} · Token #
        {record.asset.tokenId}
      </p>
      <p className="mt-2 text-sm text-muted">{labels[record.state]}</p>
      <p
        className="mt-2 break-all font-mono text-xs text-muted"
        aria-label="Order hash"
      >
        {record.orderHash}
      </p>
      <p className="mt-3 text-sm font-bold" role="status">
        {status.isLoading
          ? "Checking cancellation status…"
          : status.isError
            ? "Current chain status is unavailable."
            : (status.data ??
              "Cancellation is available. This check does not establish whether the order can currently fill.")}
      </p>
      {state.message && (
        <p className="mt-3 text-sm" role="status">
          {state.message}
        </p>
      )}
      {state.hash && (
        <a
          className="mt-3 inline-block text-sm font-bold text-ethereum"
          href={`${chainDetails[record.asset.chain].explorerUrl}/tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View cancellation transaction
        </a>
      )}
      {!status.data &&
        state.stage !== "confirmed" &&
        state.stage !== "inactive" && (
          <div className="mt-4">
            {!review ? (
              <button
                type="button"
                className={button}
                onClick={() => setReview(true)}
              >
                Review cancellation
              </button>
            ) : (
              <div className="space-y-3 rounded-2xl bg-lavender/20 p-4">
                <p className="text-sm leading-relaxed">
                  Cancel only the order shown above, signed by{" "}
                  {shortAddress(record.order.offerer)}. This requires a{" "}
                  {chainDetails[record.asset.chain].label} transaction and
                  network gas. It affects only this order. A competing trade may
                  fill before cancellation confirms.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={button}
                    disabled={busy || state.stage === "needs-confirmation"}
                    onClick={() => void cancel()}
                  >
                    {state.stage === "wallet"
                      ? "Confirm in your wallet…"
                      : state.stage === "pending"
                        ? "Waiting for confirmation…"
                        : busy
                          ? "Checking…"
                          : "Confirm cancellation"}
                  </button>
                  {!busy && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => setReview(false)}
                    >
                      Close review
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
    </li>
  );
}

export function OrderRecoveryPage() {
  const { address } = useAccount();
  const config = useConfig();
  const { openConnectModal } = useConnectModal();
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const [importing, setImporting] = useState(false);
  const [fileMessage, setFileMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [saved, setSaved] = useState<{
    records: RecoverableOrder[];
    error: boolean;
  }>({ records: [], error: false });
  usePageMetadata(
    "Order recovery | Yunipals",
    "Review and cancel Yunipals orders saved by this browser."
  );
  useEffect(() => {
    operation.current++;
    setImporting(false);
    setFileMessage(null);
    return () => {
      operation.current++;
    };
  }, [address]);
  useEffect(() => {
    const refresh = () => {
      try {
        setSaved({ records: readRecoverableOrders(), error: false });
      } catch {
        setSaved({ records: [], error: true });
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(orderRecoveryEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(orderRecoveryEvent, refresh);
    };
  }, []);
  const records = saved.records.filter(
    (record) =>
      address && getAddress(record.order.offerer) === getAddress(address)
  );
  function download() {
    const url = URL.createObjectURL(
      new Blob([encodeRecoverableOrders(records)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `yunipals-order-recovery-${address?.toLowerCase()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file: File) {
    if (!address) return;
    const current = ++operation.current;
    setImporting(true);
    setFileMessage(null);
    try {
      if (file.size > maxOrderRecoveryFileBytes)
        throw new Error(
          "Choose a cancellation records file smaller than 2 MB."
        );
      const json = await file.text();
      if (current !== operation.current) return;
      const connected = getAccount(config).address;
      if (!connected || getAddress(connected) !== getAddress(address))
        throw new Error("Your wallet changed. Choose the file again.");
      const result = importRecoverableOrders(json, connected);
      setFileMessage({
        text: result.added
          ? `Imported ${result.added} cancellation record${result.added === 1 ? "" : "s"}. ${result.existing ? `${result.existing} already saved. ` : ""}Review an order below before cancelling it.`
          : "These cancellation records are already saved in this browser.",
        error: false
      });
    } catch (error) {
      if (current !== operation.current) return;
      setFileMessage({
        text:
          error instanceof SyntaxError
            ? "This is not a valid cancellation records JSON file."
            : error instanceof Error
              ? error.message
              : "The cancellation records file could not be imported.",
        error: true
      });
    } finally {
      if (current === operation.current) setImporting(false);
    }
  }
  return (
    <main className="mx-auto min-h-[60vh] max-w-4xl px-5 py-12 sm:px-8">
      <Link to="/" className="text-sm font-bold text-ethereum">
        Back to collection
      </Link>
      <Link to="/orders" className="ml-5 text-sm font-bold text-ethereum">
        My orders
      </Link>
      <h1 className="display mt-6 text-4xl text-ink">Order recovery</h1>
      <p className="mt-4 leading-relaxed text-muted">
        Orders saved by this browser remain available here for cancellation,
        including orders for NFTs you have hidden, transferred or burned.
        Removing an order from the site does not cancel its signature.
      </p>
      <p className="mt-3 text-sm text-muted">
        Only orders saved in this browser appear here. Export your cancellation
        records to import them in another browser. Importing only saves records;
        review and confirm each cancellation in your wallet. Orders that were
        never saved or imported may not appear.
      </p>
      {address && !saved.error && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            aria-label="Cancellation records file"
            className="hidden"
            disabled={importing}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importFile(file);
            }}
          />
          <button
            type="button"
            className={button}
            disabled={importing}
            onClick={() => input.current?.click()}
          >
            {importing ? "Importing records…" : "Import cancellation records"}
          </button>
          {records.length > 0 && (
            <button type="button" className={button} onClick={download}>
              Export cancellation records
            </button>
          )}
        </div>
      )}
      {fileMessage && (
        <p
          className="mt-4 text-sm"
          role={fileMessage.error ? "alert" : "status"}
        >
          {fileMessage.text}
        </p>
      )}
      {saved.error ? (
        <p
          className="mt-6 rounded-2xl border border-line p-4 text-sm"
          role="alert"
        >
          Saved order data could not be read. Keep this browser's storage intact
          so the cancellation records can be recovered.
        </p>
      ) : !address ? (
        <button
          type="button"
          className={cn(button, "mt-6")}
          onClick={openConnectModal}
        >
          Connect wallet
        </button>
      ) : records.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          No orders for this wallet are saved in this browser.
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-4">
            {records.map((record) => (
              <SavedOrder key={recoverableOrderKey(record)} record={record} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
