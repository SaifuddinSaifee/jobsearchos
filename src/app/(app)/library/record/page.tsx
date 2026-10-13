import { redirect } from "next/navigation";

/** The career record lives in a Library tab; this keeps /library/record from being a dead link. */
export default function RecordRedirect() {
  redirect("/library?tab=record");
}
