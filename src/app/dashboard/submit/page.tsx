import { redirect } from "next/navigation";

// The assistant IS the Deploy tab now, so this route would be a second copy of
// the same surface with its own chat state. Kept as a redirect because it is
// linked from older docs, emails, and bookmarks.
export default function SubmitTaskPage() {
  redirect("/dashboard/deploy");
}
