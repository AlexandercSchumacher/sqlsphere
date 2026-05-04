/**
 * Banner shown at the top of every authenticated page in LOCAL_MODE.
 * Tells the visitor this is a self-hosted demo, links to the source.
 */

import { ExternalLink, Info } from "lucide-react";

const DEMO_BANNER_DISMISSED_KEY = "sqlsphere_demo_banner_dismissed_v1";

export const DemoBanner = () => {
  if (typeof window !== "undefined" && localStorage.getItem(DEMO_BANNER_DISMISSED_KEY) === "true") {
    return null;
  }

  const dismiss = () => {
    localStorage.setItem(DEMO_BANNER_DISMISSED_KEY, "true");
    window.dispatchEvent(new CustomEvent("demo-banner-dismissed"));
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100 px-4 py-2 text-sm flex items-center justify-center gap-3">
      <Info className="w-4 h-4 flex-shrink-0" />
      <span>
        <strong>Self-hosted demo.</strong> Backend runs on <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/50">localhost:8000</code> via{" "}
        <code className="px-1 rounded bg-amber-100 dark:bg-amber-900/50">docker compose up</code>. Schedules, alerts, dashboards, and account features are disabled.
      </span>
      <a
        href="https://github.com/AlexandercSchumacher/sqlsphere"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 underline hover:no-underline"
      >
        GitHub <ExternalLink className="w-3 h-3" />
      </a>
      <button
        onClick={dismiss}
        className="ml-2 px-2 rounded hover:bg-amber-100 dark:hover:bg-amber-900/50"
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  );
};
