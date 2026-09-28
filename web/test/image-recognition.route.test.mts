import assert from "node:assert/strict";
import test, { mock } from "node:test";

let localCalls = 0;
let visionCalls = 0;

class MockImageOcrError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

class MockScheduleVisionError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

mock.module("@/lib/server-auth", {
  namedExports: {
    getCurrentMember: async () => ({ id: 1, studentId: "2510250877", name: "测试成员" }),
    unauthorized: () => Response.json({ code: "UNAUTHORIZED" }, { status: 401 }),
  },
});

mock.module("@/lib/image-ocr-service", {
  namedExports: {
    ImageOcrError: MockImageOcrError,
    validateScheduleImage: () => undefined,
    recognizeScheduleImage: async () => {
      localCalls += 1;
      return { fileName: "schedule.png", confidence: 90, text: "课程", lines: [{ text: "课程", confidence: 90 }] };
    },
  },
});

mock.module("@/lib/schedule-vision-service", {
  namedExports: {
    ScheduleVisionError: MockScheduleVisionError,
    recognizeScheduleWithVision: async () => {
      visionCalls += 1;
      return {
        model: "qwen-test",
        drafts: [{
          id: "vision-1",
          sourceText: "课程",
          confidence: 88,
          record: { "课程名称": "课程", "教师": "", "地点": "", "星期": "周一", "开始节次": "1", "结束节次": "2", "周次": "1-18", "备注": "", "颜色": "#dce8e3" },
        }],
      };
    },
  },
});

const route = await import("@/app/api/my/schedule-import/image-ocr/route");

function imageRequest(mode: "local" | "vision") {
  const form = new FormData();
  form.append("file", new File(["image"], "schedule.png", { type: "image/png" }));
  form.append("mode", mode);
  if (mode === "vision") form.append("visionConsent", "true");
  return new Request("http://localhost/api/my/schedule-import/image-ocr", { method: "POST", body: form });
}

test("千问识别不会先执行本地 OCR", async () => {
  const response = await route.POST(imageRequest("vision"));
  assert.equal(response.status, 200);
  assert.equal(localCalls, 0);
  assert.equal(visionCalls, 1);
  const payload = await response.json();
  assert.equal(payload.data.model, "qwen-test");
  assert.equal(payload.data.drafts.length, 1);
});

test("本地模式只执行本地 OCR", async () => {
  const response = await route.POST(imageRequest("local"));
  assert.equal(response.status, 200);
  assert.equal(localCalls, 1);
  assert.equal(visionCalls, 1);
});
