import { metadataSourceMode } from "./publication.js";
if (metadataSourceMode() === "archive") await import("./archive-worker.js");
else await import("./legacy-http-worker.js");
