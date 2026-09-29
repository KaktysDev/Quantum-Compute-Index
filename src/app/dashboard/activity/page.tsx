import Link from "next/link";
import { ActivityList } from "@/components/activity/ActivityList";
import { PageHeader } from "@/components/console/ui";

export const metadata = { title: "QRouter Console — Activity" };

export default function ActivityPage() {
  return (
    <div className="console-page wide">
      <PageHeader
        title="Activity"
        description="Every job in this workspace. Jobs with several targets expand into their executions."
        actions={<Link href="/dashboard/run" className="btn btn-primary">Run a circuit</Link>}
      />
      <ActivityList />
    </div>
  );
}
