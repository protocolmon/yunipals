import type { ActivePortalStatus } from "@/lib/portals";

// Player-facing explanations are separate from the grading policy and its hash.
const rainbowCriteria = {
  Creativity:
    "Bring your own idea: a distinctive outfit, pose or theme gives your spell more character than a request like ‘make it cooler’. The automatic rainbow effect and a longer spell do not earn extra creativity points.",
  Harmony:
    "Make the rainbow colors work with your Yunipal’s original color and recognizable features. A new pose or expression is welcome; the colors, anatomy, lighting and details should feel like they belong together.",
  Craft:
    "Your finished card should bring the changes in your spell to life. Clear details, believable anatomy and a readable frame and nameplates matter. A beautiful result can still lose points if it misses your main request.",
  Impact:
    "Give your card a clear focus and a memorable presence. Quiet elegance and dramatic action can both work. Extra glitter, brighter colors or a busier background do not automatically mean a higher score."
};

export function PortalGradingGuide({
  portal
}: {
  portal: NonNullable<ActivePortalStatus["portal"]>;
}) {
  if (!portal.gradingCase) return null;
  const rainbow = portal.gradingCase.id === "rainbow-v1";
  const criteria = rainbow ? rainbowCriteria : portal.gradingCase.criteria;
  return (
    <details className="mt-4 rounded-2xl bg-white/70 p-4 text-sm">
      <summary className="cursor-pointer rounded font-bold focus-visible:outline-grape">
        How your card is graded
      </summary>
      <h3 className="mt-3 font-bold">{portal.name} grading criteria</h3>
      {rainbow && (
        <p className="mt-2 leading-relaxed text-muted">
          Your spell and the finished artwork are assessed in four categories.
          The rainbow should appear on your Yunipal’s body, with its original
          color, horn and defining features still recognizable.
        </p>
      )}
      <dl className="mt-4 space-y-4">
        {Object.entries(criteria).map(([category, description]) => (
          <div key={category}>
            <dt className="font-bold capitalize">{category}</dt>
            <dd className="mt-1 leading-relaxed text-muted">{description}</dd>
          </div>
        ))}
      </dl>
      {rainbow && (
        <p className="mt-4 border-t border-line pt-3 leading-relaxed text-muted">
          Each category is scored separately. A competent, attractive result
          typically scores 40–69; 70–89 is strong to excellent, and 90+ is
          reserved for exceptional work. Clear, specific ideas help more than a
          long spell.
        </p>
      )}
    </details>
  );
}
