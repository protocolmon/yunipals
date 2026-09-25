import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";

import {
  claimOpenSeaStreamLease,
  markOpenSeaStreamConnected,
  openSeaStreamCollections,
  parseOpenSeaStreamNotice,
  recordOpenSeaStreamGap,
  recordOpenSeaStreamHeartbeat,
  recordOpenSeaStreamNotice,
  releaseOpenSeaStreamLease,
  renewOpenSeaStreamLease,
  type OpenSeaStreamLease,
  type OpenSeaStreamTopic
} from "@/opensea/stream";

type SocketEvent = { data?: unknown };
export interface OpenSeaStreamSocket {
  readonly readyState: number;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: SocketEvent) => void,
    options?: { once?: boolean }
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: SocketEvent) => void
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type OpenSeaStreamSocketFactory = (url: string) => OpenSeaStreamSocket;

class StreamSessionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function frame(raw: string) {
  if (Buffer.byteLength(raw) > 262144)
    throw new StreamSessionError("stream_frame_too_large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StreamSessionError("stream_frame_invalid_json");
  }
  if (!Array.isArray(value) || value.length !== 5)
    throw new StreamSessionError("stream_frame_invalid_shape");
  return {
    ref: typeof value[1] === "string" ? value[1] : null,
    topic: typeof value[2] === "string" ? value[2] : null,
    event: typeof value[3] === "string" ? value[3] : null,
    payload: value[4]
  };
}

function successfulReply(payload: unknown) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    "status" in payload &&
    payload.status === "ok"
  );
}

function nativeSocket(url: string): OpenSeaStreamSocket {
  const NativeWebSocket = (
    globalThis as typeof globalThis & {
      WebSocket?: new (url: string) => OpenSeaStreamSocket;
    }
  ).WebSocket;
  if (!NativeWebSocket)
    throw new StreamSessionError("stream_websocket_unavailable");
  return new NativeWebSocket(url);
}

export async function runOpenSeaStreamSession(input: {
  pool: Pool;
  lease: OpenSeaStreamLease;
  apiKey: string;
  signal: AbortSignal;
  socketFactory?: OpenSeaStreamSocketFactory;
}) {
  const url = `wss://stream-api.opensea.io/socket/websocket?token=${encodeURIComponent(input.apiKey)}&vsn=2.0.0`;
  const socket = (input.socketFactory ?? nativeSocket)(url);
  const topics = Object.keys(openSeaStreamCollections) as OpenSeaStreamTopic[];
  const joins = new Map<string, OpenSeaStreamTopic>();
  let nextRef = 0;
  let joined = false;
  let joining = false;
  let queuedMessages = 0;
  let queuedBytes = 0;
  let processing = Promise.resolve();
  let heartbeatRef: string | null = null;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  let joinTimeout: ReturnType<typeof setTimeout> | undefined;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const clean = () => {
      if (joinTimeout) clearTimeout(joinTimeout);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      input.signal.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clean();
      if (error) reject(error);
      else resolve();
    };
    const fail = (code: string) => {
      try {
        socket.close(1011, "reconcile");
      } catch {}
      finish(new StreamSessionError(code));
    };
    const sendHeartbeat = () => {
      if (!joined || settled) return;
      if (heartbeatRef !== null) {
        fail("stream_heartbeat_timeout");
        return;
      }
      heartbeatRef = String(++nextRef);
      try {
        socket.send(
          JSON.stringify([null, heartbeatRef, "phoenix", "heartbeat", {}])
        );
      } catch {
        fail("stream_send_failed");
        return;
      }
      heartbeatTimeout = setTimeout(
        () => fail("stream_heartbeat_timeout"),
        10000
      );
    };
    const processMessage = async (raw: string) => {
      const value = frame(raw);
      if (value.event === "phx_reply") {
        if (!successfulReply(value.payload))
          throw new StreamSessionError("stream_join_rejected");
        if (value.ref === heartbeatRef && value.topic === "phoenix") {
          heartbeatRef = null;
          if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
          heartbeatTimeout = undefined;
          if (!(await recordOpenSeaStreamHeartbeat(input.pool, input.lease)))
            throw new StreamSessionError("stream_lease_lost");
          return;
        }
        if (value.ref && joins.has(value.ref)) {
          joins.delete(value.ref);
          if (joins.size === 0 && !joined && !joining) {
            joining = true;
            if (!(await markOpenSeaStreamConnected(input.pool, input.lease)))
              throw new StreamSessionError("stream_lease_lost");
            joined = true;
            joining = false;
            if (joinTimeout) clearTimeout(joinTimeout);
            heartbeatInterval = setInterval(sendHeartbeat, 30000);
          }
          return;
        }
        throw new StreamSessionError("stream_unexpected_reply");
      }
      if (value.event === "phx_error" || value.event === "phx_close")
        throw new StreamSessionError("stream_topic_closed");
      const notice = parseOpenSeaStreamNotice(raw);
      if (!notice) return;
      await recordOpenSeaStreamNotice(input.pool, input.lease, notice);
    };
    const onOpen = () => {
      try {
        for (const topic of topics) {
          const ref = String(++nextRef);
          joins.set(ref, topic);
          socket.send(JSON.stringify([ref, ref, topic, "phx_join", {}]));
        }
        joinTimeout = setTimeout(() => fail("stream_join_timeout"), 12000);
      } catch {
        fail("stream_send_failed");
      }
    };
    const onMessage = (event: SocketEvent) => {
      if (typeof event.data !== "string") {
        fail("stream_binary_frame");
        return;
      }
      const bytes = Buffer.byteLength(event.data);
      if (
        bytes > 262144 ||
        queuedMessages >= 500 ||
        queuedBytes + bytes > 4 * 1024 * 1024
      ) {
        fail(
          bytes > 262144 ? "stream_frame_too_large" : "stream_queue_overflow"
        );
        return;
      }
      queuedMessages++;
      queuedBytes += bytes;
      processing = processing
        .then(() => processMessage(event.data as string))
        .catch((error: unknown) => {
          fail(
            error instanceof StreamSessionError
              ? error.code
              : error instanceof Error &&
                  /^[a-z][a-z0-9_]{0,63}$/.test(error.message)
                ? error.message
                : "stream_persistence_failed"
          );
        })
        .finally(() => {
          queuedMessages--;
          queuedBytes -= bytes;
        });
    };
    const onError = () => fail("stream_connection_error");
    const onClose = () => {
      if (input.signal.aborted) void processing.finally(() => finish());
      else fail("stream_connection_closed");
    };
    const onAbort = () => {
      try {
        socket.close(1000, "stopped");
      } catch {
        void processing.finally(() => finish());
      }
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    if (input.signal.aborted) onAbort();
  });
}

export async function runOpenSeaStreamWorker(input: {
  pool: Pool;
  apiKey: string;
  signal: AbortSignal;
  socketFactory?: OpenSeaStreamSocketFactory;
}) {
  let connections = 0;
  let gaps = 0;
  let leaseClaims = 0;
  const pause = async (ms: number, signal: AbortSignal) => {
    try {
      await delay(ms, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  };
  while (!input.signal.aborted) {
    const lease = await claimOpenSeaStreamLease(input.pool);
    if (!lease) {
      await pause(5000, input.signal);
      continue;
    }
    leaseClaims++;
    const leader = new AbortController();
    const signal = AbortSignal.any([input.signal, leader.signal]);
    const renew = async () => {
      while (!signal.aborted) {
        await pause(10000, signal);
        if (
          !signal.aborted &&
          !(await renewOpenSeaStreamLease(input.pool, lease))
        )
          leader.abort();
      }
    };
    const connect = async () => {
      let failures = 0;
      while (!signal.aborted) {
        connections++;
        try {
          await runOpenSeaStreamSession({ ...input, lease, signal });
          failures = 0;
        } catch (error) {
          if (signal.aborted) break;
          const reason =
            error instanceof StreamSessionError
              ? error.code
              : "stream_session_failed";
          if (!(await recordOpenSeaStreamGap(input.pool, lease, reason))) {
            leader.abort();
            break;
          }
          gaps++;
          failures++;
          const ceiling = Math.min(
            30000,
            1000 * 2 ** Math.min(failures - 1, 5)
          );
          await pause(
            Math.max(250, Math.floor(Math.random() * ceiling)),
            signal
          );
        }
      }
    };
    const results = await Promise.allSettled(
      [renew, connect].map(async (loop) => {
        try {
          await loop();
        } catch (error) {
          leader.abort();
          throw error;
        }
      })
    );
    await releaseOpenSeaStreamLease(input.pool, lease).catch(() => false);
    if (
      !input.signal.aborted &&
      results.some((result) => result.status === "rejected")
    )
      throw new StreamSessionError("stream_worker_failed");
  }
  return { leaseClaims, connections, gaps };
}
