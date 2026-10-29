import { Link } from "react-router-dom";

export function ArenaHub() {
  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-12 text-ink">
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Yunipals Arena
      </p>
      <h1 className="mt-3 font-display text-4xl">Choose your battle</h1>
      <p className="mt-4 text-muted">
        Four fighters, one island draw and one champion. Your NFTs stay in your
        wallet.
      </p>
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {[
          {
            path: "/arena/video",
            name: "Video battles",
            entry: "2",
            prize: "6",
            description: "Cinematic battles with generated video."
          },
          {
            path: "/arena/anime",
            name: "Anime battles",
            entry: "1",
            prize: "3.20",
            description: "Animated battles with signature attack kits."
          }
        ].map((mode) => (
          <Link
            key={mode.path}
            to={mode.path}
            className="rounded-card border border-line p-6 transition hover:border-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
          >
            <h2 className="text-2xl font-bold">{mode.name}</h2>
            <p className="mt-3 text-muted">{mode.description}</p>
            <p className="mt-4 font-semibold">
              {mode.entry} USDC entry · {mode.prize} USDC champion payout
            </p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">
        In the shared arena, the first successful entry also pays the quoted
        island draw fee in ETH. Later entries pay USDC and network gas only.
        Unused ETH is returned automatically.
      </p>
      <nav
        className="mt-8 flex flex-wrap gap-5 text-sm font-semibold"
        aria-label="Arena setup and previous battles"
      >
        <Link className="underline" to="/arena/setup">
          Set up shared Arena
        </Link>
        <Link className="underline" to="/arena/history">
          Previous video battles
        </Link>
        <Link className="underline" to="/arena/me">
          Previous video payouts and claims
        </Link>
      </nav>
    </main>
  );
}
