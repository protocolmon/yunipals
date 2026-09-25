import { registerHooks } from "node:module";
import { extname } from "node:path";

// Node 22 can strip TypeScript, but needs resolution for the extensionless
// imports and @/ alias used by this Vite app. No production loader is installed.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith(".ts")) {
      if (specifier.startsWith("@protopals/yunipals-market-core/")) {
        return nextResolve(
          new URL(
            `../../../packages/yunipals-market-core/src/${specifier.slice("@protopals/yunipals-market-core/".length)}.ts`,
            import.meta.url
          ).href,
          context
        );
      }
      if (specifier.startsWith("@/")) {
        return nextResolve(
          new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
          context
        );
      }
      if (
        specifier.startsWith(".") &&
        ![".js", ".mjs", ".cjs", ".json", ".ts", ".tsx"].includes(
          extname(specifier)
        )
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  }
});
