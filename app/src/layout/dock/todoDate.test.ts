import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMondayBasedWeekRange, getTodoDefaultDue} from "./todoDate";

describe("getMondayBasedWeekRange", () => {
    it("按周一到周日计算本周", () => {
        assert.deepEqual(getMondayBasedWeekRange("2026-07-23"), {
            start: "2026-07-20",
            end: "2026-07-26",
        });
    });

    it("周一和周日都归入同一周", () => {
        assert.deepEqual(getMondayBasedWeekRange("2026-07-20"), {
            start: "2026-07-20",
            end: "2026-07-26",
        });
        assert.deepEqual(getMondayBasedWeekRange("2026-07-26"), {
            start: "2026-07-20",
            end: "2026-07-26",
        });
    });

    it("上一周支持跨年", () => {
        assert.deepEqual(getMondayBasedWeekRange("2026-01-01", -1), {
            start: "2025-12-22",
            end: "2025-12-28",
        });
    });

    it("本周新建待办默认使用今天，确保保存后仍在当前筛选中", () => {
        assert.equal(getTodoDefaultDue("week", "2026-07-24"), "2026-07-24");
    });

    it("上周新建待办默认使用上周最后一天", () => {
        assert.equal(getTodoDefaultDue("lastWeek", "2026-07-24"), "2026-07-19");
    });
});
