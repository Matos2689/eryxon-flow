import { describe, expect, it } from "vitest";
import { effectiveDueDate } from "./due-date";

describe("effectiveDueDate", () => {
  it("returns null for a job without a due date instead of the 1970 epoch", () => {
    expect(effectiveDueDate({ due_date: null, due_date_override: null })).toBeNull();
    expect(effectiveDueDate({})).toBeNull();
  });

  it("prefers the override over the original due date", () => {
    const due = effectiveDueDate({ due_date: "2026-10-01T00:00:00Z", due_date_override: "2026-10-15T00:00:00Z" });
    expect(due?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("falls back to the original due date and ignores unparseable values", () => {
    expect(effectiveDueDate({ due_date: "2026-10-01T00:00:00Z" })?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(effectiveDueDate({ due_date: "not a date" })).toBeNull();
  });
});
