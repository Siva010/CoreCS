import { PageHeader } from "@/components/ui/badges";
import { ProgressDashboard } from "@/components/pages/ProgressDashboard";

export const metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Progress"
        title="Where you actually stand"
        description="Not one meaningless percentage: coverage and answer quality per area, weak topics, roadmap readiness and your practice history."
      />
      <ProgressDashboard />
    </div>
  );
}
