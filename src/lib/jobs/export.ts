import { formatDate } from "./format";
import { toCsv } from "./csv";
import { sourceLabel } from "./links";
import { statusInfo } from "./status";
import type { ExportRow } from "./tracker";

export function jobsToCsv(rows: ExportRow[]): string {
  return toCsv(rows, [
    { header: "Company", value: (r) => r.company },
    { header: "Title", value: (r) => r.title },
    { header: "Location", value: (r) => r.location },
    { header: "Remote", value: (r) => r.remoteType },
    { header: "Salary min", value: (r) => r.salaryMin },
    { header: "Salary max", value: (r) => r.salaryMax },
    { header: "Currency", value: (r) => r.salaryCurrency },
    { header: "Period", value: (r) => r.salaryPeriod },
    { header: "Status", value: (r) => statusInfo(r.status).label },
    { header: "Applied", value: (r) => formatDate(r.appliedAt) },
    { header: "Saved", value: (r) => formatDate(r.createdAt) },
    { header: "Posted", value: (r) => formatDate(r.postedAt) },
    { header: "Source", value: (r) => sourceLabel(r.source) },
    { header: "Posting URL", value: (r) => r.postingUrl },
    { header: "Apply URL", value: (r) => r.applyUrl },
    { header: "Technologies", value: (r) => r.technologies.join("; ") },
    { header: "Notes", value: (r) => r.notes },
  ]);
}
