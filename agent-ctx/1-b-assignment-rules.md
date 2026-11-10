# Task 1-b — Assignment Rules Engine Enhancements

**Agent:** 1-b (Rules Engine Part 3)
**Date:** session date
**Status:** ✅ Complete — all quality gates green

## Files changed (owned list only)

| File | Change |
|---|---|
| `src/lib/crm/assignment.ts` | Engine rebuilt: dual-format criteria matcher (legacy flat + structured rows), priority→specificity→createdAt ordering, `onlyIfUnassigned` guard, role-based pool (`assignToRole`), trigger stats (`triggerCount`/`lastTriggeredAt` in `applyAssignmentRules` — the single documented place), best-effort in-app/email notifications with a 15s in-process double-notify guard, exported `notifyAssignment()` helper, `recordAssignment` gained optional `ruleSnapshot` param (fully backward compatible). Engine never throws — degrades to fallback. |
| `src/app/api/assignment-rules/route.ts` | GET now returns ALL rules (active + inactive, needed for the Activate/Deactivate toggle), same auth/tenant pattern. POST sanitizes + validates the full new format (targetModel enum, strategy enum, criteria rows field+operator, priority int 0–9999, booleans) and audits `assignment_rule.create`. |
| `src/app/api/assignment-rules/[id]/route.ts` | Added PATCH + POST (alias) for partial updates (isActive toggle, priority, name, criteria, notifications, …), tenant-scoped, re-sanitized, audited. DELETE unchanged (still delegates to `deleteAssignmentRule`). |
| `src/components/rule-engine/views/rule-builder.tsx` | ONLY the `AssignmentRules` component rebuilt (ValidationRules / EscalationRules / RuleBuilderView untouched except shared import line additions). 3-section builder (Rule Info / Criteria / Assignment Action), 8-field catalog with per-type operators, stable-key criteria rows, AND|OR toggle, Specific User / Specific Role / pool modes, notify checkboxes, only-if-unassigned switch, rich rule list (name, Active pill, priority badge, pretty criteria, owners/role, Last Triggered, Times Triggered), AlertDialog confirms for toggle + delete. |

## Verification performed

- 40/40 matcher semantics tests (verbatim extraction of the criteria section, run with bun) — legacy flat semantics byte-identical, all 13 operators, empty-field policy, AND/OR, catch-alls, specificity.
- 10/10 engine E2E tests against a **disposable copy** of `db/custom.db` (never touched the live DB):
  specific-beats-catch-all, legacy lead catch-all still fires (owner from its own 6-id pool), priority-0 OR rule first, role pool resolution, empty role pool skip-through, onlyIfUnassigned both ways, notifyAssignment never throws + dedupe path, engine never throws, trigger stats bump.
- Owned files: `eslint` exit 0. `tsc --noEmit`: only the 3 pre-existing errors (examples/websocket, skills/image-edit, __tests__) — zero new.
- Route smoke-tested over HTTP while unauthenticated → 401 (compiles + auth pattern intact).

## Key design decisions

1. **Trigger stats live in `applyAssignmentRules`** (documented in code) — that is where a rule genuinely fires; `recordAssignment` only replays the decision.
2. **Notifications**: engine notifies without `targetId` (handler.ts path); `recordAssignment({ruleSnapshot})` and exported `notifyAssignment()` notify WITH the record id for API-route callers. A size-capped Map (15s TTL, `${ruleId}:${assignedToId}`) prevents double-notify if both paths ever run for the same assignment.
3. **Specific User** = strategy `round_robin` + pool (length-1 pool IS the specific user — no new strategy value). **Specific Role** = `round_robin` + `assignToRole`; role only changes pool resolution.
4. **Criteria sanitizer** rejects a rows-payload whose rows are ALL invalid (prevents an intended specific rule silently becoming a catch-all).
5. **GET returns inactive rules too** — required for re-activation; scoped to org.
6. Empty-field policy: `is_not`/`does_not_contain` stay TRUE for empty record fields (documented in `rowMatches` JSDoc); every other operator is FALSE.

## Caveats / notes for next agents

- Date operators (`is_today`/`is_before`/`is_after`/`is_overdue`) are fully implemented engine-side but the UI field catalog has no date field (spec's 8 fields are all picklist/number/text) — reachable via API.
- `createAssignmentRule`/`listAssignmentRules` in `src/lib/rule-engine/handler.ts` are still used by nothing for assignment rules anymore (route inlines its own sanitize + Prisma); the handler exports remain untouched for compatibility.
- The legacy rule (flat `{}`, no name/priority, targetModel lead) renders as "Round Robin / All records" and keeps firing — verified against the real DB copy (org "Zia Data QA's Workspace").
- Full UI E2E (create New-Recruiter→specific-user rule, watch trigger counters) is documented in the agent's final report and needs an authenticated browser session.
