import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    areTodoStatisticsRowsExpanded,
    getTodoStatisticsCategoryHierarchy,
    getTodoStatisticsDate,
    getTodoStatisticsPresetRange,
    getTodoStatisticsProjectHierarchy,
    isTodoWithinStatisticsRange,
    isTodoStatisticsRowExpanded,
} from "./todoStatistics";
import {TODO_AI_PARENT_CATEGORY} from "./todoCategory";

describe("todoStatisticsRowExpansion", () => {
    const categories = [
        {category: TODO_AI_PARENT_CATEGORY, hasChildren: true},
        {category: "AI 功能开发", hasChildren: false},
        {category: "工作", hasChildren: false},
    ];

    it("父级默认折叠，叶子默认不显示明细", () => {
        assert.equal(isTodoStatisticsRowExpanded(categories[0], new Set(), new Set()), false);
        assert.equal(isTodoStatisticsRowExpanded(categories[1], new Set(), new Set()), false);
    });

    it("父级与全部叶子都展开时返回真", () => {
        assert.equal(areTodoStatisticsRowsExpanded(categories,
            new Set(["AI 功能开发", "工作"]), new Set([TODO_AI_PARENT_CATEGORY])), true);
    });

    it("父级或任一叶子未展开时返回假", () => {
        assert.equal(areTodoStatisticsRowsExpanded(categories,
            new Set(["AI 功能开发", "工作"]), new Set()), false);
        assert.equal(areTodoStatisticsRowsExpanded(categories,
            new Set(["AI 功能开发"]), new Set([TODO_AI_PARENT_CATEGORY])), false);
        assert.equal(areTodoStatisticsRowsExpanded([], new Set(), new Set()), false);
    });
});

describe("getTodoStatisticsPresetRange", () => {
    it("本周按周一到周日生成日期区间", () => {
        assert.deepEqual(getTodoStatisticsPresetRange("week", "2026-08-04"), {
            start: "2026-08-03",
            end: "2026-08-09",
        });
    });

    it("上周支持跨月", () => {
        assert.deepEqual(getTodoStatisticsPresetRange("lastWeek", "2026-08-04"), {
            start: "2026-07-27",
            end: "2026-08-02",
        });
    });

    it("全部清空日期区间", () => {
        assert.deepEqual(getTodoStatisticsPresetRange("all", "2026-08-04"), {
            start: "",
            end: "",
        });
    });
});

describe("isTodoWithinStatisticsRange", () => {
    it("未选择区间时保留全部事项", () => {
        assert.equal(isTodoWithinStatisticsRange({
            completed: false,
            due: "",
            updatedAt: 0,
        }, "", ""), true);
    });

    it("进行中事项按截止日期筛选并包含区间边界", () => {
        const item = {
            completed: false,
            due: "2026-07-18",
            updatedAt: 0,
        };
        assert.equal(isTodoWithinStatisticsRange(item, "2026-07-18", "2026-07-20"), true);
        assert.equal(isTodoWithinStatisticsRange(item, "2026-07-19", "2026-07-20"), false);
    });

    it("已完成事项按完成日期筛选", () => {
        const completedAt = new Date(2026, 6, 18).getTime();
        const item = {
            completed: true,
            completedAt,
            due: "2026-06-01",
            updatedAt: completedAt,
        };
        assert.equal(getTodoStatisticsDate(item), "2026-07-18");
        assert.equal(isTodoWithinStatisticsRange(item, "2026-07-01", "2026-07-31"), true);
    });

    it("选择区间后排除没有截止日期的进行中事项", () => {
        assert.equal(isTodoWithinStatisticsRange({
            completed: false,
            due: "",
            updatedAt: 0,
        }, "2026-07-01", ""), false);
    });
});

describe("getTodoStatisticsCategoryHierarchy", () => {
    it("将 AI 子分类聚合到 AI 开发，并保留子分类明细", () => {
        const statistics = getTodoStatisticsCategoryHierarchy([
            {category: "工作", total: 3, completed: 2, inProgress: 1, completionRate: 67, completedItems: ["工作"]},
            {category: "AI 开发", total: 2, completed: 1, inProgress: 1, completionRate: 50, completedItems: ["开发"]},
            {category: "AI 功能开发", total: 4, completed: 4, inProgress: 0, completionRate: 100, completedItems: ["功能"]},
            {category: "AI 测试", total: 3, completed: 2, inProgress: 1, completionRate: 67, completedItems: ["测试"]},
        ], ["工作", "AI 开发", "AI 功能开发", "AI 测试"]);

        assert.deepEqual(statistics, [
            {category: "工作", total: 3, completed: 2, inProgress: 1, completionRate: 67, completedItems: ["工作"], hasChildren: false},
            {category: "AI 开发", total: 9, completed: 7, inProgress: 2, completionRate: 78, completedItems: ["开发", "功能", "测试"], hasChildren: true},
            {category: "AI 功能开发", total: 4, completed: 4, inProgress: 0, completionRate: 100, completedItems: ["功能"], parentCategory: "AI 开发", hasChildren: false},
            {category: "AI 测试", total: 3, completed: 2, inProgress: 1, completionRate: 67, completedItems: ["测试"], parentCategory: "AI 开发", hasChildren: false},
        ]);
    });

    it("聚合父标签时对双标签待办去重", () => {
        const statistics = getTodoStatisticsCategoryHierarchy([
            {
                category: "AI 功能开发", total: 1, completed: 1, inProgress: 0, completionRate: 100,
                completedItems: ["同一待办"], itemIds: ["task-1"], completedItemIds: ["task-1"],
            },
            {
                category: "AI 测试", total: 1, completed: 1, inProgress: 0, completionRate: 100,
                completedItems: ["同一待办"], itemIds: ["task-1"], completedItemIds: ["task-1"],
            },
        ], [TODO_AI_PARENT_CATEGORY, "AI 功能开发", "AI 测试"]);

        assert.deepEqual(statistics[0], {
            category: TODO_AI_PARENT_CATEGORY,
            total: 1,
            completed: 1,
            inProgress: 0,
            completionRate: 100,
            completedItems: ["同一待办"],
            itemIds: ["task-1"],
            completedItemIds: ["task-1"],
            hasChildren: true,
        });
    });
});

describe("getTodoStatisticsProjectHierarchy", () => {
    it("父项目聚合思源子项目统计，同时保留子项目明细", () => {
        const statistics = getTodoStatisticsProjectHierarchy([
            {
                category: "siyuan-note", total: 1, completed: 1, inProgress: 0, completionRate: 100,
                completedItems: ["内核"], itemIds: ["core"], completedItemIds: ["core"],
            },
            {
                category: "siyuan-todo-plus", total: 2, completed: 1, inProgress: 1, completionRate: 50,
                completedItems: ["待办"], itemIds: ["todo-1", "todo-2"], completedItemIds: ["todo-1"],
            },
        ], ["siyuan-note", "siyuan-todo-plus"]);

        assert.deepEqual(statistics, [
            {
                category: "siyuan-note", total: 3, completed: 2, inProgress: 1, completionRate: 67,
                completedItems: ["内核", "待办"], itemIds: ["core", "todo-1", "todo-2"],
                completedItemIds: ["core", "todo-1"], hasChildren: true,
            },
            {
                category: "siyuan-todo-plus", total: 2, completed: 1, inProgress: 1, completionRate: 50,
                completedItems: ["待办"], itemIds: ["todo-1", "todo-2"], completedItemIds: ["todo-1"],
                parentCategory: "siyuan-note", hasChildren: false,
            },
        ]);
    });
});
