import { notFound } from "next/navigation";
import { z } from "zod";
import { OutreachWorkspace } from "@/components/outreach/outreach-workspace";
import { getJobDetail } from "@/lib/jobs/tracker";
import { getOutreachData } from "@/lib/outreach/service";

export const dynamic = "force-dynamic";

export default async function OutreachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const job = await getJobDetail(id);
  if (!job) notFound();
  const data = await getOutreachData(id);

  return (
    <OutreachWorkspace
      job={{ id, title: job.title, company: job.company, location: job.location, postingUrl: job.postingUrl, status: job.status }}
      initial={data}
    />
  );
}
