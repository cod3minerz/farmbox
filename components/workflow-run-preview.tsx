"use client";

import { getSmoothStepPath, SmoothStepEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/demo";

export type ExecutionEdge = Edge<{ pulse?: string }, "smoothstep">;

export function WorkflowTransition(props: EdgeProps<ExecutionEdge>) {
  const pathOptions = { borderRadius: 18 };
  const [path] = getSmoothStepPath({ ...props, ...pathOptions });
  return <>
    <SmoothStepEdge {...props} pathOptions={pathOptions} />
    {props.data?.pulse && <path key={props.data.pulse} className="workflow-signal" d={path} pathLength={1} />}
  </>;
}

export function useRunPlayback(run: Run | undefined, playRunId: string) {
  const runId = run?.id;
  const offset = run?.stepOffset ?? 0;
  const total = offset + (run?.steps.length ?? 0);
  const playing = Boolean(runId && runId === playRunId);
  const [cursor, setCursor] = useState({ id: "", count: 0, settled: false });
  const count = !playing ? total : cursor.id === runId ? Math.max(offset, Math.min(cursor.count, total)) : offset;
  const presenting = playing && (count < total || Boolean(count && !cursor.settled));

  useEffect(() => {
    if (!runId || !presenting) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const catchUp = () => setCursor({ id: runId, count: total, settled: true });
    const timer = setTimeout(() => {
      if (reduced.matches || document.hidden || count >= total) catchUp();
      else setCursor({ id: runId, count: count + 1, settled: false });
    }, count === offset || cursor.settled ? 0 : 235);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [presenting, runId, count, total, offset, cursor.settled]);

  const steps = run?.steps.slice(0, count - offset) ?? [];
  const current = steps.at(-1);
  const nodeStates = new Map<string, Run["steps"][number]["status"]>();
  const traversed = new Set<string>();
  for (const step of steps) {
    if (step.nodeId) nodeStates.set(step.nodeId, step.status);
    if (step.edgeId) traversed.add(step.edgeId);
  }
  if (presenting && !cursor.settled && current?.nodeId) nodeStates.set(current.nodeId, "running");
  const pulse = playing && current?.edgeId ? { edgeId: current.edgeId, key: runId + ":" + count } : undefined;

  return { nodeStates, traversed, pulse, current, index: count, presenting };
}
