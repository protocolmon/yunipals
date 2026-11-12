import {
  portalScoreCategories,
  stablePortalJson,
  validatePortalScores,
  type PortalGradingAssessment,
  type PortalGradingCase,
  type PortalScores
} from "@protopals/yunipals-market-core/portals";

export function applyPortalGradingCase(
  profile: PortalGradingCase,
  rawScores: PortalScores,
  categoryReasons: PortalGradingAssessment["categoryReasons"],
  checks: PortalGradingAssessment["checks"]
) {
  validatePortalScores(rawScores);
  if (
    Object.keys(checks).length !== profile.checks.length ||
    profile.checks.some((check) => !checks[check.id])
  )
    throw new Error(
      "The grading assessment must cover exactly this portal's checks."
    );
  const scores = { ...rawScores };
  const adjustments: PortalGradingAssessment["adjustments"] = [];
  for (const check of profile.checks) {
    const result = checks[check.id];
    if (result.outcome === "met") continue;
    const limits = check.limits[result.outcome];
    for (const category of portalScoreCategories) {
      const maximum = limits[category];
      if (maximum === undefined || scores[category] <= maximum) continue;
      adjustments.push({
        checkId: check.id,
        category,
        from: scores[category],
        to: maximum,
        reason: result.evidence
      });
      scores[category] = maximum;
    }
  }
  const assessment: PortalGradingAssessment = {
    caseId: profile.id,
    categoryReasons,
    checks,
    rawScores: { ...rawScores },
    adjustments
  };
  return { scores, assessment };
}

export function verifyPortalGradingAssessment(
  profile: PortalGradingCase,
  grading: { scores: PortalScores; assessment?: PortalGradingAssessment }
) {
  const assessment = grading.assessment;
  if (!assessment || assessment.caseId !== profile.id)
    throw new Error("Grading result does not match the accepted portal case.");
  const expected = applyPortalGradingCase(
    profile,
    assessment.rawScores,
    assessment.categoryReasons,
    assessment.checks
  );
  if (
    stablePortalJson(expected.scores) !== stablePortalJson(grading.scores) ||
    stablePortalJson(expected.assessment) !== stablePortalJson(assessment)
  )
    throw new Error("Grading result does not match the portal case ceilings.");
}
