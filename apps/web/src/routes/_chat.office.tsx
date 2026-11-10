import { createFileRoute } from "@tanstack/react-router";

import { OfficePage } from "../components/office/OfficePage";

export const Route = createFileRoute("/_chat/office")({ component: OfficePage });
