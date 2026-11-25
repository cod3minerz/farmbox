import type { Metadata } from "next";
import { AndroidWall } from "@/components/android-devices";

export const metadata: Metadata = { title: "Стена устройств · Hashpix Automation" };

type Params = Record<string, string | string[] | undefined>;

export default async function WallPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { status } = await searchParams;
  return <AndroidWall status={typeof status === "string" ? status : undefined} />;
}
