import { notFound } from "next/navigation";
import { z } from "zod";
import { ResumeWriter } from "@/components/resume-writer/resume-writer";
import { getJobDetail } from "@/lib/jobs/tracker";
import { getJobResumeState } from "@/lib/resume-writer/service";

export const dynamic = "force-dynamic";

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const job = await getJobDetail(id);
  if (!job) notFound();
  const initial = await getJobResumeState(id);
  return <ResumeWriter job={{ id, title: job.title, company: job.company, location: job.location, status: job.status }} initial={initial} />;
}
