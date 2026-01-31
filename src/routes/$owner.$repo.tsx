import { createFileRoute } from "@tanstack/react-router"
import { RepoComparisonPage } from "./$"

export const Route = createFileRoute("/$owner/$repo")({
  component: RepoComparisonPage,
})
