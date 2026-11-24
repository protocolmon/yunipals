import type {
  ArenaPublicTournament,
  ArenaSeat
} from "@protopals/yunipals-market-core/arena";
import { cn } from "@/lib/utils";

const steps = [
  "Choose fighter",
  "Confirm entry",
  "Wait for opponents",
  "Submit strategy",
  "Watch battle"
];

export function ArenaJourney({
  tournament,
  ownedSeats,
  confirming
}: {
  tournament: ArenaPublicTournament;
  ownedSeats: ArenaSeat[];
  confirming: boolean;
}) {
  if (tournament.phase === "expired") return null;

  const entered = ownedSeats.length > 0;
  const full = tournament.seats.length >= 4;
  const allSubmitted =
    entered &&
    ownedSeats.every((seat) => tournament.submittedSeats.includes(seat.seat));
  const current =
    tournament.phase === "open"
      ? entered || full
        ? 2
        : confirming
          ? 1
          : 0
      : tournament.phase === "strategies"
        ? 3
        : 4;
  const title =
    tournament.phase === "open"
      ? entered
        ? "You’re entered — here’s what happens next"
        : full
          ? "This battle is full"
          : confirming
            ? "Complete your entry in your wallet"
            : "One fighter is all you need"
      : tournament.phase === "strategies"
        ? entered
          ? allSubmitted
            ? "Your strategy is locked"
            : "Next: submit your strategy"
          : "The fighters are preparing their strategies"
        : tournament.phase === "resolving"
          ? "The referee is deciding the battle"
          : "The battle result is ready";
  const description =
    tournament.phase === "open"
      ? entered
        ? "Wait for all four fighters and the island to be ready. Then return to My battles to submit your strategy."
        : full
          ? "All four slots are taken. Choose another battle from Join a battle, or follow this one here."
          : confirming
            ? "Follow the wallet prompts for approval and entry. Wait for your entry to be confirmed here before leaving."
            : "Four fighters share each battle. Choose one below; other players can fill the remaining slots."
      : tournament.phase === "strategies"
        ? entered
          ? allSubmitted
            ? "Wait for the other fighters to submit or for the deadline. Your submitted choices cannot be changed."
            : "Review the island below, then use Plan your battle to submit before the deadline."
          : "Entry is closed for this battle. You can follow its progress here."
        : tournament.phase === "resolving"
          ? "The result comes first, followed by the battle film. Check back here to watch."
          : "Reveal the result and watch the film below when it is available.";

  return (
    <section aria-label="Battle steps" className="my-6">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
              index === current
                ? "bg-ink font-semibold text-white"
                : "bg-lavender/20 text-muted"
            )}
          >
            <span aria-hidden="true">{index + 1}.</span> {step}
          </li>
        ))}
      </ol>
      <h2 className="mt-5 text-xl font-bold">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        {description}
      </p>
    </section>
  );
}
