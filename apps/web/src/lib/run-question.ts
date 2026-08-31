type RunMessage = { id?: string; role: string; content: string; runId?: string };

export function questionForRun(messages: RunMessage[], runId: string) {
  const responseIndex = messages.findIndex((message) => message.runId === runId);
  if (responseIndex < 0) return "未找到关联问题";
  for (let index = responseIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].content;
  }
  return "未找到关联问题";
}
