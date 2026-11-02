import { createFileRoute } from "@tanstack/react-router";

import { WorkingOverviewPage } from "../components/working/WorkingOverviewPage";

export const Route = createFileRoute("/_chat/working")({
  component: WorkingOverviewPage,
});
