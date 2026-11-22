import { randomUUID } from "node:crypto";
import type { ScopyDatabase } from "../db/database.js";
import type { PermissionEffect, PermissionRule, PermissionRuleInput } from "./types.js";

interface PermissionRuleRow {
  id: string;
  actor_id: string;
  tool_name: string;
  action_name: string;
  target_pattern: string;
  effect: PermissionEffect;
  created_at: string;
  updated_at: string;
}

function mapRule(row: PermissionRuleRow): PermissionRule {
  return {
    id: row.id,
    actorId: row.actor_id,
    tool: row.tool_name,
    action: row.action_name,
    targetPattern: row.target_pattern,
    effect: row.effect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PermissionRepository {
  constructor(private readonly database: ScopyDatabase) {}

  setRule(input: PermissionRuleInput): PermissionRule {
    const actorId = input.actorId.trim();
    const tool = input.tool.trim();
    const action = input.action.trim();
    const targetPattern = input.targetPattern?.trim() || "*";
    if (!actorId || !tool || !action || !targetPattern) {
      throw new Error("Permission rule fields cannot be empty.");
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const save = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO permission_rules (
          id, actor_id, tool_name, action_name, target_pattern, effect, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(actor_id, tool_name, action_name, target_pattern)
        DO UPDATE SET effect = excluded.effect, updated_at = excluded.updated_at
      `).run(id, actorId, tool, action, targetPattern, input.effect, now, now);

      const row = this.database.prepare(`
        SELECT * FROM permission_rules
        WHERE actor_id = ? AND tool_name = ? AND action_name = ? AND target_pattern = ?
      `).get(actorId, tool, action, targetPattern) as PermissionRuleRow;

      this.database.prepare(`
        INSERT INTO audit_events (id, event_type, entity_type, entity_id, payload_json, created_at)
        VALUES (?, 'permission.rule.set', 'permission_rule', ?, ?, ?)
      `).run(randomUUID(), row.id, JSON.stringify({
        actorId, tool, action, targetPattern, effect: input.effect,
      }), now);
      return mapRule(row);
    });
    return save();
  }

  findMatching(actorId: string, tool: string, action: string, target: string): PermissionRule | null {
    const rows = this.database.prepare(`
      SELECT * FROM permission_rules
      WHERE actor_id IN (?, '*')
        AND tool_name IN (?, '*')
        AND action_name IN (?, '*')
    `).all(actorId, tool, action) as PermissionRuleRow[];

    const matching = rows.filter((row) =>
      row.target_pattern === "*" ||
      (row.target_pattern.endsWith("*") &&
        target.startsWith(row.target_pattern.slice(0, -1))) ||
      row.target_pattern === target
    );
    if (matching.length === 0) return null;

    const score = (row: PermissionRuleRow): number => {
      const exactDimensions =
        Number(row.actor_id !== "*") +
        Number(row.tool_name !== "*") +
        Number(row.action_name !== "*");
      const targetSpecificity = row.target_pattern === "*" ? 0 :
        row.target_pattern.endsWith("*") ? Math.min(row.target_pattern.length, 499_999) :
          500_000 + Math.min(row.target_pattern.length, 499_999);
      return exactDimensions * 1_000_000 + targetSpecificity;
    };

    const bestScore = Math.max(...matching.map(score));
    const best = matching.filter((row) => score(row) === bestScore);
    const selected = best.find((row) => row.effect === "deny") ?? best[0];
    return selected ? mapRule(selected) : null;
  }
}
