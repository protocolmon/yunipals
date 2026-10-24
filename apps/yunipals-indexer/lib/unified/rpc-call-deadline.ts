import { TimeoutError, type HttpTransportConfig } from "viem";

export function boundedRpcFetch(
  dispatch: NonNullable<HttpTransportConfig["fetchFn"]>,
  timeout: number
): NonNullable<HttpTransportConfig["fetchFn"]> {
  if (!Number.isSafeInteger(timeout) || timeout < 1)
    throw new Error("A positive bounded RPC timeout is required.");
  return async (input, init) => {
    const caller =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    caller?.throwIfAborted();
    const controller = new AbortController();
    const timeoutError = new TimeoutError({
      body: {},
      url: input instanceof Request ? input.url : String(input)
    });
    const forwardAbort = () => controller.abort(caller?.reason);
    caller?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(timeoutError), timeout);
    let rejectAbort: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const cleanup = () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", forwardAbort);
      controller.signal.removeEventListener("abort", rejectAbort);
    };
    try {
      if (caller?.aborted) forwardAbort();
      controller.signal.throwIfAborted();
      const pending = dispatch(input, { ...init, signal: controller.signal });
      // A custom fetch that resolves after cancellation must not retain a body.
      void pending.then(
        (response) => {
          if (controller.signal.aborted)
            void response.body
              ?.cancel(controller.signal.reason)
              .catch(() => {});
        },
        () => {}
      );
      const response = await Promise.race([pending, aborted]);
      if (!response.body) {
        cleanup();
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const chunk = await Promise.race([reader.read(), aborted]);
            if (chunk.done) {
              cleanup();
              reader.releaseLock();
              output.close();
            } else output.enqueue(chunk.value);
          } catch (error) {
            cleanup();
            output.error(error);
            void reader
              .cancel(error)
              .catch(() => {})
              .finally(() => reader.releaseLock())
              .catch(() => {});
          }
        },
        cancel(reason) {
          controller.abort(reason);
          cleanup();
          // Local cancellation must not wait indefinitely for provider cleanup.
          void reader
            .cancel(reason)
            .catch(() => {})
            .finally(() => reader.releaseLock())
            .catch(() => {});
        }
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}
