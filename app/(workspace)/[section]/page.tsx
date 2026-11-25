import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { isSection, sections } from "@/lib/sections";

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  return <Workspace section={section} />;
}
