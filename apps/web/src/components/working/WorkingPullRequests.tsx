import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { SidebarThreadSummary } from "../../types";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";
import type { WorkingPullRequest } from "./workingOverview.logic";

/** Open pull requests linked to the page's threads; ones with a live thread come first. */
export function WorkingPullRequests({
  pullRequests,
  expanded,
  onToggle,
  className,
}: {
  pullRequests: ReadonlyArray<WorkingPullRequest<SidebarThreadSummary>>;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <section aria-label="Pull requests" className={cn("min-w-0", className)}>
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <CollapsibleSectionHeader
            expanded={expanded}
            onClick={onToggle}
            accessory={<span className="font-normal tabular-nums">{pullRequests.length}</span>}
          >
            Pull requests
          </CollapsibleSectionHeader>
        </div>
        <Link
          to="/pull-requests"
          search={readPullRequestListPreferences()}
          className="shrink-0 rounded-sm px-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          All
        </Link>
      </div>
      {!expanded ? null : pullRequests.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          No open pull requests on these threads.
        </p>
      ) : (
        <ul className="flex flex-col">
          {pullRequests.map(({ link, thread, status, active }) => {
            const state = resolvePullRequestState(link.snapshot);
            return (
              <li key={link.url} className="min-w-0">
                <Link
                  to="/$environmentId/$threadId"
                  params={buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id))}
                  title={`${link.snapshot.title} (#${link.number})`}
                  className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-1 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <state.Icon
                    aria-label={state.label}
                    className={cn("mt-0.5 size-4", state.toneClassName)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-sm leading-5 break-words">
                      {link.snapshot.title}
                      <span className="ms-1.5 text-xs text-muted-foreground tabular-nums">
                        #{link.number}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                      {active ? (
                        <span
                          aria-label={status.label}
                          className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
                        />
                      ) : null}
                      <span className="truncate">{thread.title}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
