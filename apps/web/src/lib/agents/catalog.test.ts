import { describe, expect, it } from "vitest";
import { agentPrompt, deepSeekReviewSystemPrompt, getAgent, getExecutableTool } from "./catalog";

describe("agent catalog", () => {
  it("resolves registered structured capabilities", () => {
    expect(getAgent("requirements-analyst")?.name).toBe("需求分析");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("统一对外");
  });

  it("does not expose an unimplemented tool as executable", () => {
    expect(getExecutableTool("source-search")).toBeUndefined();
    expect(getExecutableTool("memory-extractor")?.name).toBe("记忆提取器");
  });

  it("builds the complete runtime prompt at the catalog boundary", () => {
    const prompt = agentPrompt("requirements-analyst", ["message:msg_1"]);
    expect(prompt).toContain("grounded assertion");
    expect(prompt).toContain("message:msg_1");
  });

  it("owns the DeepSeek raw-API dialect instead of leaking it into the orchestrator", () => {
    const prompt = deepSeekReviewSystemPrompt(["message:msg_1"]);
    expect(prompt).toContain("JSON object");
    expect(prompt).toContain("message:msg_1");
    expect(prompt).toContain("targetRefs 只能使用提供的专家 Item IDs");
  });

  it("gives each analyst a bounded evidence and scope contract", () => {
    expect(getAgent("requirements-analyst")?.prompt).toContain("不要把建议写成正式基线");
    expect(getAgent("domain-analyst")?.prompt).toContain("用户没有说的内容只能列为假设");
    expect(getAgent("delivery-planner")?.prompt).toContain("不要凭空增加功能");
    expect(getAgent("critical-reviewer")?.prompt).toContain("只指出可验证的问题");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("问答轮不要输出 proposal");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("规划或架构讨论中包含明确需求时仍要输出 proposal");
    expect(getAgent("domain-analyst")?.prompt).toContain("只有上下文中原样存在的条目才能标为正式基线");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("每个 item 只表达一个可独立 append 的基线断言");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("同一 itemId 可以支撑多个 item");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("专家 packet 的最终结论");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("候选记忆不是本轮 proposal 的依据");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("audience=服务对象");
    expect(getAgent("pm-synthesizer")?.prompt).toContain("decisions=已明确采用的取舍或规则");
  });
});
