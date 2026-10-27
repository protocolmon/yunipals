import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { transaction } from "@/db/pool";
import { canonicalJson, sha256 } from "../draw";
import type { ArenaRules, Fighter } from "../types";
import { StrategyCipher } from "./crypto";
import {
  ArenaRefereeApi,
  refereeCandidate,
  refereeRequest
} from "./refereeApi";

type RefereeInput = {
  tournamentId: string;
  rules: ArenaRules;
  draw: { word: string };
  roster: Fighter[];
  pool: { entries?: unknown };
};
export type ValidationReport = {
  valid: boolean;
  errors: string[];
  matches: Array<{ id: string; winnerId: string }>;
};
export type SavedAdjudication = {
  input_hash: string;
  outcome_hash: string;
  candidate: unknown;
  validation: ValidationReport;
  state: "valid" | "invalid";
  winners: number[] | null;
};

export function productionValidator(root: string) {
  return (input: unknown, candidate: unknown): Promise<ValidationReport> =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify({ input, candidate });
      if (Buffer.byteLength(payload) > 1_000_000) {
        reject(new Error("Validation payload exceeds the size limit."));
        return;
      }
      const child = spawn(
        "python3",
        [join(root, "scripts/arena/validate_candidate.py")],
        {
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15_000,
          // The deterministic validator has no API credentials or provider access.
          env: {
            PATH: "/usr/local/bin:/usr/bin:/bin",
            PYTHONDONTWRITEBYTECODE: "1"
          }
        }
      );
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 200_000) child.kill();
      });
      child.stderr.resume();
      child.on("error", () =>
        reject(new Error("Referee validator could not start."))
      );
      child.stdin.on("error", () =>
        reject(new Error("Referee validator stopped early."))
      );
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              "Referee validation failed to execute; candidate retained."
            )
          );
          return;
        }
        try {
          const report = JSON.parse(output) as ValidationReport;
          if (
            typeof report.valid !== "boolean" ||
            !Array.isArray(report.errors) ||
            !Array.isArray(report.matches)
          )
            throw new Error("Invalid validation report");
          resolve(report);
        } catch {
          reject(new Error("Referee validator returned an unreadable report."));
        }
      });
      child.stdin.end(payload);
    });
}

export class ArenaAdjudicator {
  constructor(
    private readonly pool: Pool,
    private readonly cipher: StrategyCipher,
    private readonly api: ArenaRefereeApi,
    private readonly schema: unknown,
    private readonly validate: (
      input: unknown,
      candidate: unknown
    ) => Promise<ValidationReport>
  ) {}

  async step(
    deployment: string,
    id: string,
    budgetMicrousd = 1_600_000,
    expectedIncarnation?: string
  ) {
    await this.api.selected(deployment);
    const native = this.api.native;
    const origin = native
      ? await native.check(id, "referee", expectedIncarnation)
      : null;
    const incarnation = origin?.context.incarnation ?? "legacy";
    const prior = await this.pool.query<SavedAdjudication>(
      "SELECT * FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
      [deployment, id, incarnation]
    );
    if (prior.rows[0]) {
      if (origin && prior.rows[0].input_hash !== origin.proof.inputHash)
        throw new Error("Saved adjudication has a different native input.");
      return prior.rows[0];
    }
    const row = origin
      ? { input_hash: origin.proof.inputHash, ciphertext: origin.ciphertext }
      : (
          await this.pool.query<{ input_hash: string; ciphertext: string }>(
            `SELECT f.input_hash,f.ciphertext FROM yunipals_arena.frozen_input f
       JOIN yunipals_arena.tournament t ON t.deployment=f.deployment AND t.id=f.tournament_id
       WHERE f.deployment=$1 AND f.tournament_id=$2 AND f.revealed_at IS NOT NULL
       AND f.incarnation='legacy'
       AND t.state->>'phase'='resolving' AND t.state->>'inputHash'=f.input_hash`,
            [deployment, id]
          )
        ).rows[0];
    if (!row)
      throw new Error("Adjudication requires the confirmed revealed input.");
    const { input } = this.cipher.open<{ input: RefereeInput }>(
      `${origin?.context.cipherContext ?? `${deployment}/${id}`}/input`,
      row.ciphertext
    );
    if (`0x${sha256(canonicalJson(input))}` !== row.input_hash)
      throw new Error("Frozen input checksum mismatch.");
    if (
      input.rules.version !== "arena-combat-lab-v2" ||
      input.roster.length !== 4
    )
      throw new Error("Unsupported combat rules or roster.");
    const priority = input.roster
      .map((f) => f.id)
      .sort((a, b) => {
        const rank = (fighter: string) =>
          sha256(
            canonicalJson([
              "yunipals-arena/tie/v2",
              input.tournamentId,
              input.draw.word,
              fighter
            ])
          );
        return rank(a).localeCompare(rank(b));
      });
    const baseline = JSON.parse(canonicalJson(input)) as RefereeInput & {
      sourceInputSha256: string;
    };
    delete baseline.pool.entries;
    // All four public strategies and the island stay in the input. Only duplicated
    // pool data and the system prompt are removed from the user content.
    const { refereeInstructions: _, ...rules } = baseline.rules;
    Object.assign(baseline, {
      rules,
      sourceInputSha256: row.input_hash.slice(2)
    });
    const request = refereeRequest(
      input.rules.refereeInstructions +
        "\nResolve this single tournament. Public tie priority: " +
        priority.join(", ") +
        ". Return schema JSON only.\nFROZEN INPUT\n",
      baseline,
      this.schema
    );
    await this.api.reserve(
      deployment,
      id,
      request,
      budgetMicrousd,
      incarnation
    );
    const task = await this.api.step(deployment, id, incarnation);
    if (task.state !== "completed" || !task.response)
      return { state: task.state };
    const candidate = refereeCandidate(task.response);
    const validation = await this.validate(input, candidate);
    const outcomeHash = `0x${sha256(canonicalJson(candidate))}`;
    let winners: number[] | null = null;
    if (validation.valid) {
      if (
        validation.errors.length ||
        validation.matches.map((m) => m.id).join() !== "SF1,SF2,FINAL"
      )
        throw new Error("Malformed successful validation report.");
      winners = validation.matches.map((m) =>
        input.roster.findIndex((f) => f.id === m.winnerId)
      );
      if (
        ![0, 1].includes(winners[0]!) ||
        ![2, 3].includes(winners[1]!) ||
        !winners.slice(0, 2).includes(winners[2]!)
      )
        throw new Error("Validated winners do not match the paid seats.");
    }
    const accepted = origin ? await native!.refresh(origin, "referee") : null;
    return transaction(this.pool, async (db) => {
      if (accepted)
        native!.same(
          accepted,
          await native!.check(id, "referee", incarnation, db)
        );
      await db.query(
        `INSERT INTO yunipals_arena.adjudication(deployment,tournament_id,input_hash,outcome_hash,candidate,validation,state,winners,incarnation)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [
          deployment,
          id,
          row.input_hash,
          outcomeHash,
          JSON.stringify(candidate),
          JSON.stringify(validation),
          validation.valid ? "valid" : "invalid",
          winners ? JSON.stringify(winners) : null,
          incarnation
        ]
      );
      const saved = (
        await db.query<SavedAdjudication>(
          "SELECT * FROM yunipals_arena.adjudication WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3",
          [deployment, id, incarnation]
        )
      ).rows[0]!;
      if (
        saved.input_hash !== row.input_hash ||
        saved.outcome_hash !== outcomeHash
      )
        throw new Error(
          "Adjudication is already locked to a different result."
        );
      return saved;
    });
  }
}

export function refereeSchema(root: string): unknown {
  return JSON.parse(
    readFileSync(join(root, "docs/arena/rules-v2/output-schema.json"), "utf8")
  );
}
