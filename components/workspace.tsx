"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { Section } from "@/lib/sections";
import { AndroidDevices } from "./android-devices";
import { Automations } from "./automations";
import { Content, Publications } from "./content";
import { Integrations, Overview, Runs, Settings } from "./operations";

function LinkedView({ section }: { section: "publications" | "runs" }) {
  const params = useSearchParams();
  if (section === "runs") {
    const run = params.get("run") ?? undefined;
    return <Runs key={run} initialRun={run} />;
  }
  const clip = params.get("clip") ?? undefined;
  const post = params.get("post") ?? undefined;
  return <Publications key={String(clip) + String(post)} initialClip={clip} initialPost={post} />;
}

const views = { devices: AndroidDevices, overview: Overview, automations: Automations, content: Content, integrations: Integrations, settings: Settings };

export function Workspace({ section }: { section: Section }) {
  if (section === "publications" || section === "runs") return <Suspense fallback={<main id="workspace" className="workarea" aria-busy="true" />}><LinkedView section={section} /></Suspense>;
  const View = views[section];
  return <View key={section} />;
}
