/**
 * Remounts on every top-level navigation (Jobs, Companies, Profile...), so each page eases in instead of
 * replacing the previous one in a single frame. Query-string changes (opening a job, switching tabs) do not
 * remount it.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">{children}</div>;
}
