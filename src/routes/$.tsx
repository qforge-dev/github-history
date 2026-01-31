import { createFileRoute } from "@tanstack/react-router"
import { RepoHistoryPage } from "./index"

export const Route = createFileRoute("/$")({ component: RepoHistoryPage })
