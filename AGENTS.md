Yunipals Code & Styling Guide (AGENTS)

Scope
- Applies to the entire repository unless a more specific AGENTS.md exists in a subdirectory.
- These rules guide code style, structure, and UI patterns for changes in this repo.

Stack Assumptions
- Tooling: Vite + React 18 + TypeScript, TailwindCSS, Radix UI primitives, class-variance-authority (CVA), tailwind-merge, Prettier.
- Routing: react-router-dom. Use `Link` for in-app navigation.
- Aliases: `@/*` maps to `src/*` (see tsconfig.json).
- Global styles: `src/globals.css`; Tailwind theme in `tailwind.config.ts`.

Formatting
- Use Prettier (repo config): `singleQuote: false`, `trailingComma: none`.
- Keep semicolons (default Prettier behavior). Do not override print width unless needed.
- Maintain import sorting as logical groups (external → internal alias `@/` → relative). No lint-driven reordering required.

TypeScript
- Enable and preserve strict typing. Avoid `any` unless absolutely necessary and local.
- Use `type` for unions/intersections and props composed from utility types; prefer `interface` when extending DOM/React attribute types (e.g., `React.ButtonHTMLAttributes`).
- Export types with `export type` and colocate them with the component/hook when they are not reused broadly.

Modules & Exports
- Prefer named exports for components, hooks, and utilities. Match exported symbol to filename when practical.
- Create simple barrel files (`index.ts`) only where it clearly improves DX (e.g., icon exports).

Imports
- Prefer the `@/` alias for internal modules over deep relative paths.
- Do not include file extensions for TS/TSX imports.
- Import React as needed; use named React hooks from `react` and library hooks from their packages.

Components
- File naming: 
  - `src/components/ui`: follow shadcn-style lowercase filenames (e.g., `button.tsx`, `dialog.tsx`).
  - Elsewhere: use PascalCase for component filenames (e.g., `TokenInfoCard.tsx`).
- Component naming: PascalCase component names. Set `displayName` when using `forwardRef`.
- Props: keep props shallow and typed; derive variant styles via CVA. Avoid boolean prop explosions; prefer a `variant` + `size` pattern.
- Avoid default exports in new code; use named exports (e.g., `export function Component()` or `export const Component = () => {}`).

Hooks & State
- Put app-wide or reusable hooks in `src/hooks` or `src/lib/hooks` (where existing patterns live).
- Put page-specific hooks in the page’s `hooks/` folder (e.g., `src/pages/pals/[tokenAddress]/hooks`).
- Keep hooks pure (no DOM access) and return clearly named state + actions tuples/objects.

Styling
- Use Tailwind utility classes for layout and visual styles.
- Compose classes with the `cn` helper from `@/lib/utils`; never manually join class strings.
- Use CVA for variantable components in `src/components/ui` and other reusable components.
- Prefer theme tokens over hard-coded values. Use the Tailwind theme keys configured in `tailwind.config.ts`:
  - Colors: `primary`, `secondary`, `highlight`, `base` (`base.light`, `base.accent`), `destructive`, `success`, `slate-blue` scale, `trade.buy`, `trade.sell`, `custom-white`.
  - Design tokens via CSS vars: `--background`, `--foreground`, `--border`, `--ring`, etc. (defined in `globals.css`).
- Only use inline `style={}` for dynamic single-value styles; move reusable animations or keyframes to `tailwind.config.ts` (`extend.keyframes/animation`) or `globals.css`.

Layout & Spacing
- Use Tailwind’s spacing scale; avoid arbitrary pixel values unless necessary for precise alignment.
- Respect the container and radius tokens defined in Tailwind/config: `container.center`, `padding: 2rem`, and `--radius`.
- Buttons and inputs should use rounded-full/rounded tokens consistent with `button.tsx` variants.

Accessibility
- Use semantic HTML (buttons for actions; links for navigation).
- Provide `aria-*` attributes and labels for interactive elements (menus, dialogs, toggles).
- Preserve keyboard navigation and focus states; don’t remove outlines. Use `focus-visible` utilities for styling.

Files & Folders
- Pages live under `src/pages/...`. Follow existing route conventions (e.g., `.../page.tsx` and dynamic segments under directories like `[tokenAddress]`).
- Reusable UI in `src/components/ui`. Higher-level composition components in `src/components`.
- Keep page-only components inside the page folder unless they are promoted to reusable components later.
- Place domain utilities in `src/lib` (e.g., `utils.ts`, `services`, `providers`).

Data & Utilities
- Reuse helpers from `@/lib/utils` (e.g., `cn`, `formatNumber`, `formatETH`, debounce, etc.). Don’t reimplement formatting.
- Prefer `runAsyncFnWithoutBlocking` for fire-and-forget async in UI where applicable.

Networking & State Libraries
- Use libraries already present (wagmi/viem for chain, react-query if adopted in a module) rather than introducing new state/network libs.
- Centralize environment-derived values in `src/environment.ts`; for Vite, envs must be prefixed with `VITE_` to be injected.

Assets
- Store static assets in `public/images` and `public/videos`. Reference via absolute paths (`/images/...`) so Vite serves them correctly.
- Optimize heavy assets (videos, large images) and prefer modern formats when available.

Routing
- Use `react-router-dom`’s `<Link>` for internal navigation and `<a>` for external links.
- Keep route-aware styling controlled via `useLocation()` where needed; avoid global state for selected nav.

Error/Loading UI
- Provide lightweight skeletons or loading placeholders (Tailwind `animate-pulse`) for async sections.
- Render helpful error states close to the failing component; avoid throwing generic errors to the root.

Performance
- Memoize expensive components/hooks where necessary (`useMemo`, `useCallback`).
- Defer non-critical work with `startTransition` when it improves interactivity.
- Avoid unnecessary rerenders by keeping dependency arrays accurate and stable.

Testing (if/when added)
- Co-locate tests next to files using `.test.ts(x)` naming. Keep tests focused and deterministic.

PR/Change Hygiene
- Keep changes scoped and incremental. Follow these rules when touching files.
- Do not change unrelated code styling beyond Prettier formatting.
