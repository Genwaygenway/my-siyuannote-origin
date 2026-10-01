import assert = require("node:assert/strict");
import {describe, it} from "node:test";
import {mergeKnowledgeStorage, mergeTodoStorage} from "./sharedStorageMerge";

describe("mergeSharedStorageVal", () => {
    it("保留旧格式知识库选择并让有时间戳的删除获胜", () => {
        const legacy = mergeKnowledgeStorage({notebooks: ["legacy"]}, {});
        assert.deepEqual(legacy.notebooks, ["legacy"]);

        const removed = mergeKnowledgeStorage(legacy, {
            notebooks: [],
            removedAt: {legacy: 2},
        });
        assert.deepEqual(removed.notebooks, []);
    });

    it("合并知识库笔记本的最近使用时间", () => {
        const merged = mergeKnowledgeStorage({usedAt: {first: 10, second: 20}}, {usedAt: {first: 30}});
        assert.deepEqual(merged.usedAt, {first: 30, second: 20});
    });

    it("合并知识库文档的最近使用时间", () => {
        const merged = mergeKnowledgeStorage({docsUsedAt: {first: 10, second: 20}}, {docsUsedAt: {first: 30}});
        assert.deepEqual(merged.docsUsedAt, {first: 30, second: 20});
    });

    it("按版本合并日历记录并保留删除标记", () => {
        const merged = mergeTodoStorage({
            calendarEntries: [{id: "deleted", text: "旧记录", createdAt: 1, updatedAt: 4, deletedAt: 4}],
        }, {
            calendarEntries: [
                {id: "deleted", text: "旧记录", createdAt: 1, updatedAt: 2},
                {id: "new", text: "新记录", createdAt: 5, updatedAt: 5},
            ],
        });
        assert.deepEqual(merged.calendarEntries, [
            {id: "deleted", text: "旧记录", createdAt: 1, updatedAt: 4, deletedAt: 4},
            {id: "new", text: "新记录", createdAt: 5, updatedAt: 5},
        ]);
    });

    it("保留项目标题覆盖并容忍损坏的存储值", () => {
        const merged = mergeTodoStorage(null, {
            projectLabelOverrides: {project: "项目"},
        });
        assert.deepEqual(merged.projectLabelOverrides, {project: "项目"});
        assert.deepEqual(merged.items, []);
    });

    it("分类和项目的删除时间相等时删除获胜，同时保留旧格式显式列表", () => {
        const merged = mergeTodoStorage({
            categories: ["旧分类", "已删分类"],
            projects: ["旧项目", "已删项目"],
            categoryUpdatedAt: {"已删分类": 10},
            deletedCategories: {"已删分类": 10},
            projectUpdatedAt: {"已删项目": 20},
            deletedProjects: {"已删项目": 20},
        }, {});
        assert.deepEqual(merged.categories, ["旧分类"]);
        assert.deepEqual(merged.projects, ["旧项目"]);
    });
});
