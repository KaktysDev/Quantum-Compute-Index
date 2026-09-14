import TasksTable from "@/components/TasksTable";

export default function Page() {
  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>Activity</h1>
          <p>Every job in this workspace. Open a run for charts, the brief, and downloads — pending and failed jobs stay as stored.</p>
        </div>
      </div>
      <TasksTable />
    </div>
  );
}
