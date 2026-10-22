import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import { defineConfig, loadEnv } from "vite";

import { fixturePlugin } from "./scripts/fixtures/devServer";
import { llmRacePlugin } from "./scripts/racing/devServer";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // These values stay in the dev-server closure and are never VITE_* defines.
  const raceEnv = loadEnv(mode, process.cwd(), ["OPENAI_API_KEY", "RACING_"]);
  if (mode === "fixtures" && command === "build") {
    throw new Error("Fixture mode is for local development only.");
  }
  if (command === "build" && env.VITE_SELF_HOSTED === "1") {
    for (const name of [
      "VITE_YUNIPALS_MARKETPLACE_URL",
      "VITE_YUNIPALS_INDEXER_URL"
    ]) {
      const value = env[name]?.trim();
      if (!value) throw new Error(`Self-hosted builds require ${name}.`);
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`Invalid ${name} URL.`);
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.hash ||
        url.hostname === "yunipals.com" ||
        url.hostname.endsWith(".yunipals.com")
      )
        throw new Error(`${name} must point to your own service.`);
    }
  }
  if (
    command === "build" &&
    process.env.VERCEL_ENV === "production" &&
    !env.VITE_WALLETCONNECT_PROJECT_ID?.trim()
  ) {
    throw new Error(
      "Production deployment requires VITE_WALLETCONNECT_PROJECT_ID. " +
        "Add your public Reown project ID in Vercel before building."
    );
  }
  if (
    command === "build" &&
    process.env.VERCEL_ENV === "production" &&
    env.VITE_COLLECTION_ONLY !== "true" &&
    !env.VITE_YUNIPALS_MARKETPLACE_URL?.trim()
  ) {
    throw new Error(
      "Production deployment requires VITE_YUNIPALS_MARKETPLACE_URL. " +
        "Set it to https://api.yunipals.com/yunipals-marketplace in Vercel before building."
    );
  }

  return {
    plugins: [
      react(),
      llmRacePlugin({
        apiKey: process.env.OPENAI_API_KEY || raceEnv.OPENAI_API_KEY || "",
        model: process.env.RACING_LLM_MODEL || raceEnv.RACING_LLM_MODEL || ""
      }),
      ...(mode === "fixtures" ? [fixturePlugin()] : []),
      {
        ...license({
          banner: {
            commentStyle: "ignored",
            content: "Third-party licenses: /THIRD_PARTY_LICENSES.txt"
          },
          thirdParty: {
            includePrivate: true,
            multipleVersions: true,
            output: {
              file:
                process.env.YUNIPALS_LICENSE_OUTPUT ||
                "dist/THIRD_PARTY_LICENSES.txt",
              template: (dependencies) =>
                [
                  readFileSync(
                    new URL(
                      "../../licenses/browser-supplement.txt",
                      import.meta.url
                    ),
                    "utf8"
                  ),
                  ...dependencies.map((dependency) => dependency.text())
                ].join("\n\n---\n\n")
            }
          }
        }),
        apply: "build"
      }
    ],
    ...(mode === "fixtures"
      ? {
          define: {
            "import.meta.env.VITE_YUNIPALS_INDEXER_URL": JSON.stringify(
              "http://127.0.0.1:5177/__fixtures/indexer"
            ),
            "import.meta.env.VITE_YUNIPALS_MARKETPLACE_URL": JSON.stringify(
              "http://127.0.0.1:5177/__fixtures/market"
            ),
            "import.meta.env.VITE_WALLETCONNECT_PROJECT_ID": JSON.stringify("")
          }
        }
      : {}),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@protopals/yunipals-market-core": fileURLToPath(
          new URL("../../packages/yunipals-market-core/src", import.meta.url)
        )
      }
    },
    server: {
      host: "localhost",
      port: 5177,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/*.key",
          "**/.arena-lab/**",
          "**/*.sqlite",
          "**/*.sqlite-*"
        ]
      },
      proxy:
        process.env.ARENA_LAB === "1"
          ? {
              "/api/arena": {
                target: "http://127.0.0.1:53901",
                changeOrigin: false
              }
            }
          : undefined
    }
  };
});
