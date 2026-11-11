# Community proposals catalog

Each proposal is a concept with its own landing page. Proposals are plain code
in this folder: there is no form, database or admin screen. To publish one, add
its folder and ship the site.

- Catalog page: `/proposals` (linked from the footer)
- Proposal page: `/proposals/<slug>`

## The rule: one proposal, one folder

A proposal is fully contained in `catalog/<slug>/`. Adding, changing or
removing a proposal touches that folder and nothing else:

- No registration. Every folder here that has an `index.ts` is discovered
  automatically and listed on the catalog page.
- No shared assets. Images, styles, components and helpers the proposal needs
  live inside its folder, not in `public/` or elsewhere in `src/`.
- No edits to routes, the footer, the catalog page or other proposals.

A proposal may _use_ what the site already offers (theme tokens, `cn`,
`@/components`, `@/lib`, existing images in `public/`), but it must not change
any of it. If a proposal seems to need a change outside its folder, copy what
it needs into the folder instead.

## Folder layout

```
catalog/<slug>/
  index.ts       required: title, summary, author, date, landing
  Landing.tsx    required: the landing page body
  avatar.webp    required: the author's profile picture
  cover.webp     optional: image for the catalog card
  …              anything else the landing needs
```

The folder name is the slug and the URL: `catalog/my-idea/` is served at
`/proposals/my-idea`. Use lowercase letters, digits and hyphens.

## What `index.ts` exports

It exports one constant named `proposal`:

| Field         | Required | Notes                                                        |
| ------------- | -------- | ------------------------------------------------------------ |
| `title`       | yes      | Shown on the card and as the page heading.                   |
| `summary`     | yes      | One or two sentences. Card text and page introduction.       |
| `author`      | yes      | `name`, `avatar` (profile picture) and an optional `link`.   |
| `publishedAt` | yes      | ISO date, `YYYY-MM-DD`. The newest proposal is listed first. |
| `cover`       | no       | Card image. Without it the card shows a plain gradient.      |
| `optionCount` | no       | Number of options on the landing page, shown on the card.    |
| `Landing`     | yes      | The landing page body, loaded lazily.                        |

The full type is `ProposalDefinition` in [`types.ts`](types.ts).

## Add a proposal

1. **Create the folder** `catalog/<slug>/`.

2. **Add the images** to the folder and import them, so they ship with the
   proposal:
   - Profile picture: square, at least 192×192, WebP or PNG.
   - Cover: any shape; it is fitted inside a 176px-tall card header.

3. **Write the landing page** in `Landing.tsx`. Export a component named
   `Landing` that takes no props. The page shell already renders the back
   link, title, summary and author, so the landing starts with the body: the
   idea, then the options.

   ```tsx
   export function Landing() {
     return (
       <section className="max-w-3xl space-y-4 text-lg leading-relaxed text-muted">
         <h2 className="font-display text-2xl text-ink sm:text-3xl">
           The idea
         </h2>
         <p>What this proposal is and why it matters.</p>
       </section>
     );
   }
   ```

   Present options however suits the idea: cards, images, a comparison table,
   or something interactive. Follow the repository `AGENTS.md` (Tailwind theme
   tokens, `cn`, named exports, accessible markup).

4. **Describe the proposal** in `index.ts`:

   ```ts
   import { lazy } from "react";

   import type { ProposalDefinition } from "../types";
   import avatar from "./avatar.webp";
   import cover from "./cover.webp";

   export const proposal: ProposalDefinition = {
     title: "My idea",
     summary: "One or two sentences about the idea.",
     author: {
       name: "Author name",
       avatar,
       link: "https://example.com/author"
     },
     publishedAt: "2026-11-10",
     cover,
     optionCount: 3,
     Landing: lazy(() =>
       import("./Landing").then((module) => ({ default: module.Landing }))
     )
   };
   ```

5. **Check it** with `pnpm typecheck`, then open `/proposals` and
   `/proposals/<slug>` in `pnpm dev`. The change should contain files from
   `catalog/<slug>/` only.

## Remove or retire a proposal

Delete its folder. Its old URL then redirects to the catalog.

## Notes

- The landing is loaded only when someone opens the proposal, so a heavy
  interactive landing does not slow down the catalog or the rest of the site.
- Proposals are ideas for discussion. Do not present one as a decision, a
  schedule or a promise.
- Voting is not part of this catalog.

## Example

[`pack-opening/`](pack-opening) presents eleven playable pack-opening concepts.
Its interactive player, shaders and styles all live in `pack-opening/opening/`.
