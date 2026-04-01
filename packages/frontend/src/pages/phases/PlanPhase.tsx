import { usePlanPhaseMain, type PlanPhaseProps } from "./planPhase/usePlanPhaseMain";

export type { PlanPhaseProps };
export { getPlanChatMessageDisplay } from "./planPhase/planPhaseUtils";

export function PlanPhase(props: PlanPhaseProps) {
  return usePlanPhaseMain(props);
}
