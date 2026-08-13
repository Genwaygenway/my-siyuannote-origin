import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getTodoReorderState} from "./todoHierarchy";

describe("getTodoReorderState", () => {
    it("同级待办可以相互排序", () => {
        assert.deepEqual(getTodoReorderState("parent", "parent"), {
            allowed: true,
            promoted: false,
            parentId: "parent",
        });
    });

    it("二级待办拖到一级待办前后时提升为一级", () => {
        assert.deepEqual(getTodoReorderState("parent", undefined), {
            allowed: true,
            promoted: true,
            parentId: undefined,
        });
    });

    it("一级待办不能通过前后放置直接变成二级", () => {
        assert.deepEqual(getTodoReorderState(undefined, "parent"), {
            allowed: false,
            promoted: false,
            parentId: "parent",
        });
    });
});
