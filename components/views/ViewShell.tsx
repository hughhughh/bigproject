"use client";

import { DEFAULT_VIEW_ID } from "./registry";
import { WeekView } from "./WeekView";

export function ViewShell() {
  const activeView = DEFAULT_VIEW_ID;
  switch (activeView) {
    case "week":
      return <WeekView />;
    default:
      return <WeekView />;
  }
}
