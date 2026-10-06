/**
 * Regression tests for HUD transcript TaskCreate/TaskUpdate handling.
 *
 * Covers support for Claude Code's Task tool system which replaces
 * TodoWrite in current versions. TaskCreate and TaskUpdate work with
 * an insertion-ordered todo list that persists across the session.
 *
 * TaskCreate: creates a pending todo with subject/description/activeForm.
 * TaskUpdate: modifies status, subject, or activeForm; "deleted" removes.
 * Interaction: TodoWrite replaces the full list; Task tools apply on top.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseTranscript } from "../../hud/transcript.js";

const tempDirs: string[] = [];

function createTempTranscript(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "omc-hud-task-tools-"));
  tempDirs.push(dir);
  const p = join(dir, "transcript.jsonl");
  writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return p;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("HUD transcript — TaskCreate/TaskUpdate", () => {
  describe("TaskCreate basics", () => {
    it("adds a pending todo when TaskCreate tool_result succeeds", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_001",
                name: "TaskCreate",
                input: { subject: "Fix HUD todos rendering" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_001",
                content: [{ type: "text", text: "Task #1234 created successfully." }],
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.content).toBe("Fix HUD todos rendering");
      expect(result.todos[0]?.status).toBe("pending");
    });

    it("ignores TaskCreate with error result", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_err",
                name: "TaskCreate",
                input: { subject: "Failing task" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_err",
                content: [{ type: "text", text: "Error: invalid subject" }],
                is_error: true,
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(0);
    });

    it("uses activeForm when provided", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_form",
                name: "TaskCreate",
                input: {
                  subject: "Refactor parser",
                  activeForm: "Extract parsing logic",
                },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_form",
                content: [{ type: "text", text: "Task #2000 created." }],
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.content).toBe("Extract parsing logic");
      expect(result.todos[0]?.activeForm).toBe("Extract parsing logic");
    });

    it("preserves status from TaskCreate input", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_status",
                name: "TaskCreate",
                input: { subject: "Already started task", status: "in_progress" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_status",
                content: [{ type: "text", text: "Task #3000 created." }],
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.status).toBe("in_progress");
    });
  });

  describe("TaskCreate with proxy_TaskCreate", () => {
    it("handles proxy_TaskCreate like TaskCreate", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_proxy_tc",
                name: "proxy_TaskCreate",
                input: { subject: "Proxied task creation" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_proxy_tc",
                content: [{ type: "text", text: "Task #4000 created." }],
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.content).toBe("Proxied task creation");
    });
  });

  describe("TaskUpdate basics", () => {
    it("updates status of existing task", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_upd1",
                name: "TaskCreate",
                input: { subject: "Pending work" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_upd1",
                content: [{ type: "text", text: "Task #5000 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_001",
                name: "TaskUpdate",
                input: { taskId: "5000", subject: "Pending work", status: "in_progress" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.status).toBe("in_progress");
    });

    it("marks task as completed", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_comp",
                name: "TaskCreate",
                input: { subject: "Task to complete" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_comp",
                content: [{ type: "text", text: "Task #6000 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_comp",
                name: "TaskUpdate",
                input: { taskId: "6000", subject: "Task to complete", status: "completed" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.status).toBe("completed");
    });

    it("removes task with deleted status", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_del",
                name: "TaskCreate",
                input: { subject: "Task to delete" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_del",
                content: [{ type: "text", text: "Task #7000 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_del",
                name: "TaskUpdate",
                input: { taskId: "7000", subject: "Task to delete", status: "deleted" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(0);
    });

    it("gracefully ignores unknown task IDs", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_unknown",
                name: "TaskUpdate",
                input: { taskId: "unknown-id", subject: "Non-existent task", status: "completed" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(0);
    });
  });

  describe("TaskUpdate with proxy_TaskUpdate", () => {
    it("handles proxy_TaskUpdate like TaskUpdate", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_proxy_upd",
                name: "TaskCreate",
                input: { subject: "Task for proxy update" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_proxy_upd",
                content: [{ type: "text", text: "Task #8000 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_proxy_tu",
                name: "proxy_TaskUpdate",
                input: { taskId: "8000", subject: "Task for proxy update", status: "completed" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.status).toBe("completed");
    });
  });

  describe("TodoWrite + Task tools interaction", () => {
    it("TodoWrite replaces list, Task tools apply on top", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tw_full",
                name: "TodoWrite",
                input: {
                  todos: [
                    { content: "Original task 1", status: "pending" },
                    { content: "Original task 2", status: "pending" },
                  ],
                },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_new",
                name: "TaskCreate",
                input: { subject: "Additional task" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_new",
                content: [{ type: "text", text: "Task #9000 created." }],
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(3);
      expect(result.todos[0]?.content).toBe("Original task 1");
      expect(result.todos[1]?.content).toBe("Original task 2");
      expect(result.todos[2]?.content).toBe("Additional task");
    });
  });

  describe("Multi-step workflows", () => {
    it("creates 3 tasks, marks one in_progress, completes another", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_1",
                name: "TaskCreate",
                input: { subject: "Task 1" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_1",
                content: [{ type: "text", text: "Task #10001 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_2",
                name: "TaskCreate",
                input: { subject: "Task 2" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:03.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_2",
                content: [{ type: "text", text: "Task #10002 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:04.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_3",
                name: "TaskCreate",
                input: { subject: "Task 3" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:05.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_3",
                content: [{ type: "text", text: "Task #10003 created." }],
              },
            ],
          },
        },
        // Update Task 1 to in_progress
        {
          timestamp: "2026-04-07T00:00:06.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_1",
                name: "TaskUpdate",
                input: { taskId: "10001", subject: "Task 1", status: "in_progress" },
              },
            ],
          },
        },
        // Complete Task 3
        {
          timestamp: "2026-04-07T00:00:07.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_3",
                name: "TaskUpdate",
                input: { taskId: "10003", subject: "Task 3", status: "completed" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(3);
      expect(result.todos[0]?.status).toBe("in_progress");
      expect(result.todos[1]?.status).toBe("pending");
      expect(result.todos[2]?.status).toBe("completed");
    });
  });

  describe("Task tool with missing result", () => {
    it("ignores TaskCreate if result never arrives", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_orphan",
                name: "TaskCreate",
                input: { subject: "Orphaned task" },
              },
            ],
          },
        },
        // No tool_result follows
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      // Pending task is not finalized without a successful tool_result
      expect(result.todos).toHaveLength(0);
    });
  });

  describe("Complex task state transitions", () => {
    it("handles pending → in_progress → completed sequence", async () => {
      const transcriptPath = createTempTranscript([
        {
          timestamp: "2026-04-07T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tc_complex",
                name: "TaskCreate",
                input: { subject: "Complex workflow task" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_tc_complex",
                content: [{ type: "text", text: "Task #11000 created." }],
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_c1",
                name: "TaskUpdate",
                input: { taskId: "11000", subject: "Complex workflow task", status: "in_progress" },
              },
            ],
          },
        },
        {
          timestamp: "2026-04-07T00:00:03.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_tu_c2",
                name: "TaskUpdate",
                input: { taskId: "11000", subject: "Complex workflow task", status: "completed" },
              },
            ],
          },
        },
      ]);

      const result = await parseTranscript(transcriptPath, { staleTaskThresholdMinutes: 10 ** 9 });
      expect(result.todos).toHaveLength(1);
      expect(result.todos[0]?.status).toBe("completed");
    });
  });
});
