import { PreparingNext } from "@/components/career/preparing-next";
import { ProposalReview } from "@/components/career/proposal-review";
import { getCareerStatus, getOpenReview } from "@/lib/career/review";
import { currentRecord } from "@/lib/career/service";

export const dynamic = "force-dynamic";

/** Reviews the next source before it joins the career record. Nothing is added until it is saved here. */
export default async function ReviewPage() {
  const [review, status, latest] = await Promise.all([getOpenReview(), getCareerStatus(), currentRecord()]);
  if (!review) return <PreparingNext initial={status} />;
  return <ProposalReview key={review.proposalId} review={review} record={latest.record} done={status.done} total={status.total} />;
}
