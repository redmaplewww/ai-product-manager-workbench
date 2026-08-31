import { canRunExploreRound, type ExploreCall, type ExplorePlan } from "./explore";

type ExploreObservation = {
  action: ExploreCall;
  summary: string;
};

type ExploreLoopOptions = {
  decide: (round: number, observations: ExploreObservation[]) => Promise<ExplorePlan>;
  execute: (action: ExploreCall) => Promise<{ summary: string }>;
};

export async function runExploreLoop({ decide, execute }: ExploreLoopOptions) {
  const observations: ExploreObservation[] = [];
  for (let round = 0; canRunExploreRound(round); round += 1) {
    const plan = await decide(round, observations);
    if (!plan.calls.length) return { answer: plan.text, summary: plan.summary, observations, exhausted: false };
    for (const action of plan.calls) {
      const result = await execute(action);
      observations.push({ action, summary: result.summary });
    }
  }
  return { answer: undefined, summary: "已达到探索轮次上限。", observations, exhausted: true };
}
