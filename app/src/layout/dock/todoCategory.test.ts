import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTodoCategoryHierarchy, isTodoCategoryMatch, TODO_AI_PARENT_CATEGORY} from "./todoCategory";

const categories = ["", "工作", TODO_AI_PARENT_CATEGORY, "AI 功能开发", "AI 优化与修复", "生活"];

describe("getTodoCategoryHierarchy", () => {
    it("将其它 AI 标签排列为 AI 开发的子标签", () => {
        assert.deepEqual(getTodoCategoryHierarchy(categories), [
            {category: "", hasChildren: false},
            {category: "工作", hasChildren: false},
            {category: TODO_AI_PARENT_CATEGORY, hasChildren: true},
            {category: "AI 功能开发", parentCategory: TODO_AI_PARENT_CATEGORY, hasChildren: false},
            {category: "AI 优化与修复", parentCategory: TODO_AI_PARENT_CATEGORY, hasChildren: false},
            {category: "生活", hasChildren: false},
        ]);
    });

    it("缺少主标签时保留 AI 标签的原有层级", () => {
        assert.deepEqual(getTodoCategoryHierarchy(["AI 测试"]), [
            {category: "AI 测试", hasChildren: false},
        ]);
    });
});

describe("isTodoCategoryMatch", () => {
    it("主标签同时匹配自身和全部 AI 子标签", () => {
        assert.equal(isTodoCategoryMatch(TODO_AI_PARENT_CATEGORY, TODO_AI_PARENT_CATEGORY, categories), true);
        assert.equal(isTodoCategoryMatch("AI 功能开发", TODO_AI_PARENT_CATEGORY, categories), true);
        assert.equal(isTodoCategoryMatch("工作", TODO_AI_PARENT_CATEGORY, categories), false);
    });

    it("子标签只匹配自身", () => {
        assert.equal(isTodoCategoryMatch("AI 功能开发", "AI 功能开发", categories), true);
        assert.equal(isTodoCategoryMatch("AI 优化与修复", "AI 功能开发", categories), false);
    });

    it("两个标签中任意一个匹配即可筛选到待办", () => {
        assert.equal(isTodoCategoryMatch(["工作", "AI 功能开发"], "工作", categories), true);
        assert.equal(isTodoCategoryMatch(["工作", "AI 功能开发"], TODO_AI_PARENT_CATEGORY, categories), true);
        assert.equal(isTodoCategoryMatch(["工作", "生活"], "AI 功能开发", categories), false);
    });

    it("没有标签的待办仅匹配未分类", () => {
        assert.equal(isTodoCategoryMatch([], "", categories), true);
        assert.equal(isTodoCategoryMatch([], "工作", categories), false);
    });
});
