import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import {
    IWorkItemNotificationListener,
    WorkItemTrackingServiceIds,
} from "azure-devops-extension-api/WorkItemTracking";

import { DEPLOYMENT_TYPE_LABELS, DEPLOYMENT_TYPE_ORDER, DeploymentRecord } from "../Contracts";
import { orderGroups, relativeTime } from "../Deployments";
import AzdoClient from "../Services/AzdoClient";
import DeploymentQueryService, {
    DeploymentsResult,
    GroupedDeployments,
    PipelineDeployments,
} from "../Services/DeploymentQueryService";

import "azure-devops-ui/Core/override.css";
import "./DeploymentsGroup.scss";

interface Urls {
    pipelines: string;
    deployment(record: DeploymentRecord): string;
    pipeline(pipeline: PipelineDeployments): string;
}

/**
 * The Azure DevOps status icons, as `azure-devops-ui`'s `Status` draws them at size m. Copied
 * inline: importing `Status` pulls in the library's core styles and tooltip, which this bundle
 * avoids (see CLAUDE.md).
 */
type Icon = "success" | "warning" | "failed" | "running" | "waiting" | "queued" | "canceled" | "skipped";

const STATUS: Record<DeploymentRecord["result"], { icon: Icon; label: string }> = {
    succeeded: { icon: "success", label: "Succeeded" },
    partiallySucceeded: { icon: "warning", label: "Partially succeeded" },
    failed: { icon: "failed", label: "Failed" },
    canceled: { icon: "canceled", label: "Canceled" },
    skipped: { icon: "skipped", label: "Skipped" },
    inProgress: { icon: "running", label: "In progress" },
    waitingForApproval: { icon: "waiting", label: "Waiting for approval" },
    unknown: { icon: "queued", label: "Unknown" },
};

/** Azure DevOps' status colors, through the theme's variables. */
const SUCCESS = "var(--component-status-success, rgba(85, 163, 98, 1))";
const ERROR = "var(--component-status-error, rgba(205, 74, 69, 1))";
const WARNING = "var(--component-status-warning, rgba(214, 127, 60, 1))";
const INFO = "var(--component-status-info, rgba(0, 120, 212, 1))";
const NEUTRAL = "var(--component-status-neutral, rgba(102, 102, 102, 1))";

/** A filled circle with a white glyph, or a white disc in a ring with the glyph cut out. */
const ICONS: Record<Icon, { color: string; filled: boolean; path: string }> = {
    success: {
        color: SUCCESS,
        filled: true,
        path: "M6.062 11.144l-.003-.002-1.784-1.785A.937.937 0 1 1 5.6 8.031l1.125 1.124 3.88-3.88A.937.937 0 1 1 11.931 6.6l-4.54 4.54-.004.004a.938.938 0 0 1-1.325 0z",
    },
    warning: {
        color: WARNING,
        filled: true,
        path: "M8.91 3.9a.9.9 0 0 0-1.8 0v4.7a.9.9 0 1 0 1.8 0V3.9zm-.95 8.65a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z",
    },
    failed: {
        color: ERROR,
        filled: true,
        path: "M10.984 5.004a.9.9 0 0 1 0 1.272L9.27 7.99l1.74 1.741a.9.9 0 1 1-1.272 1.273l-1.74-1.741-1.742 1.74a.9.9 0 1 1-1.272-1.272l1.74-1.74-1.713-1.714a.9.9 0 0 1 1.273-1.273l1.713 1.713 1.714-1.713a.9.9 0 0 1 1.273 0z",
    },
    running: {
        color: INFO,
        filled: true,
        path: "M4.75 8a3.25 3.25 0 0 1 1.917-2.965c.33-.148.583-.453.583-.814 0-.479-.432-.848-.881-.683A4.752 4.752 0 0 0 3.29 8.62c.064.49.616.697 1.043.45.303-.175.443-.528.423-.877A3.304 3.304 0 0 1 4.75 8zm6.5 0c0 .065-.002.13-.006.194-.02.349.12.702.422.877.428.247.98.04 1.044-.45a4.752 4.752 0 0 0-3.078-5.084c-.45-.164-.882.205-.882.684 0 .36.253.666.583.814A3.25 3.25 0 0 1 11.25 8zM8 11.25c.758 0 1.455-.26 2.008-.694.293-.23.696-.31 1.019-.123.402.233.51.77.167 1.083A4.733 4.733 0 0 1 8 12.75c-1.23 0-2.35-.467-3.194-1.234-.344-.312-.235-.85.168-1.083.322-.186.725-.108 1.018.123.553.435 1.25.694 2.008.694z",
    },
    waiting: {
        color: INFO,
        filled: true,
        path: "M8 3.5a.9.9 0 0 1 .9.9v3.325l2.002 2.001A.9.9 0 1 1 9.629 11L7.408 8.778A.898.898 0 0 1 7.1 8.1V4.4a.9.9 0 0 1 .9-.9z",
    },
    queued: {
        color: NEUTRAL,
        filled: false,
        path: "M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm0-1.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z",
    },
    canceled: {
        color: NEUTRAL,
        filled: false,
        path: "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-1.5 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM6.41 5.124a.9.9 0 1 0-1.274 1.272l4.385 4.385a.9.9 0 1 0 1.272-1.273L6.41 5.124z",
    },
    skipped: {
        color: NEUTRAL,
        filled: false,
        path: "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-1.5 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM6.752 4.372a.861.861 0 0 1 1.218 0l3.005 3.005a.86.86 0 0 1 .252.62.859.859 0 0 1-.252.626L7.97 11.628a.861.861 0 1 1-1.218-1.218L9.162 8l-2.41-2.41a.861.861 0 0 1 0-1.218z",
    },
};

function StatusIcon(props: { result: DeploymentRecord["result"] }): JSX.Element {
    const { icon, label } = STATUS[props.result] || STATUS.unknown;
    const { color, filled, path } = ICONS[icon];

    return (
        <svg
            className="dsb-status"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            role="img"
            aria-label={label}
            focusable="false"
            style={{ color }}
        >
            <title>{label}</title>
            {filled ? (
                <>
                    <circle cx="8" cy="8" r="8" fill="currentColor" />
                    {icon === "running" ? (
                        <g className="dsb-status-running-arcs">
                            <path d={path} fill="#fff" />
                        </g>
                    ) : (
                        <path d={path} fill="#fff" fillRule="evenodd" clipRule="evenodd" />
                    )}
                </>
            ) : (
                <>
                    <circle cx="8" cy="8" r="7" fill="#fff" />
                    <path d={path} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
                </>
            )}
        </svg>
    );
}

/** What the subtitle says before " on <environment>": the time, or the state of an unfinished deployment. */
function whenOf(record: DeploymentRecord): string {
    if (record.result === "inProgress" || record.result === "waitingForApproval") {
        return STATUS[record.result].label;
    }
    return relativeTime(record.finishTime);
}

function PipelineRow(props: { pipeline: PipelineDeployments; urls: Urls }): JSX.Element {
    const { pipeline, urls } = props;
    const [expanded, setExpanded] = React.useState(false);
    const { latest } = pipeline;

    return (
        <div className="dsb-pipeline">
            <div
                className="dsb-pipeline-header"
                onClick={() => setExpanded(!expanded)}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpanded(!expanded);
                    }
                }}
            >
                <StatusIcon result={latest.result} />
                <span className="dsb-pipeline-text">
                    <a
                        className="dsb-pipeline-name"
                        href={urls.pipeline(pipeline)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        title={pipeline.pipelineName}
                    >
                        {pipeline.pipelineName} ({pipeline.history.length})
                    </a>
                    <span className="dsb-pipeline-subtitle">
                        {whenOf(latest)} on {latest.environmentName || latest.stageName}
                    </span>
                </span>
                <span className={`dsb-chevron ${expanded ? "dsb-chevron--open" : ""}`} aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="10" height="10" focusable="false">
                        <path d="M2 5l6 6 6-6-1.2-1.2L8 8.6 3.2 3.8z" fill="currentColor" />
                    </svg>
                </span>
            </div>

            {expanded && (
                <div className="dsb-runs">
                    {pipeline.history.map((record) => (
                        <div
                            className="dsb-run"
                            // Only the latest attempt of a rerun stage is kept, so this is unique.
                            key={`${record.runId}-${record.environmentId}-${record.stageName}`}
                        >
                            <StatusIcon result={record.result} />
                            <a
                                className="dsb-run-link"
                                href={urls.deployment(record)}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                #{record.runName || record.runId}
                            </a>
                            <span className="dsb-run-arrow">{"\u2192"}</span>
                            <span className="dsb-run-stage">
                                {record.environmentName || record.stageName}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function EmptyState(props: { noRuns: boolean; urls: Urls }): JSX.Element {
    const pipelines = (
        <a href={props.urls.pipelines} target="_blank" rel="noopener noreferrer">
            Pipelines
        </a>
    );

    return (
        <div className="dsb-empty">
            To track deployments associated with this work item, go to {pipelines} and turn on{" "}
            {props.noRuns
                ? "Automatically link work items included in this run in your pipeline's Settings. "
                : "deployment status reporting for Boards in your pipeline's Boards Integration menu. "}
            <a
                href="https://github.com/excelery/azdo-extension-deployment-status#readme"
                target="_blank"
                rel="noopener noreferrer"
            >
                Learn more about deployment status reporting
            </a>
        </div>
    );
}

function useAutoResize(ready: boolean, deps: unknown): void {
    const lastReported = React.useRef(0);

    React.useEffect(() => {
        if (!ready) {
            return undefined;
        }

        const report = () => {
            const content = document.querySelector(".dsb-root");
            if (!content) {
                return;
            }

            const height = Math.ceil(content.getBoundingClientRect().height) + 2;

            if (height < 8 || Math.abs(height - lastReported.current) <= 2) {
                return;
            }

            lastReported.current = height;
            try {
                SDK.resize(window.innerWidth, height);
            } catch {
            }
        };

        report();

        const raf = window.requestAnimationFrame(report);
        const timers = [window.setTimeout(report, 150), window.setTimeout(report, 600)];

        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== "undefined") {
            const content = document.querySelector(".dsb-root");
            if (content) {
                observer = new ResizeObserver(report);
                observer.observe(content);
            }
        }

        return () => {
            window.cancelAnimationFrame(raf);
            timers.forEach((timer) => window.clearTimeout(timer));
            if (observer) {
                observer.disconnect();
            }
        };
    }, [ready, deps]);
}

function DeploymentsGroup(): JSX.Element {
    const [ready, setReady] = React.useState(false);
    const [result, setResult] = React.useState<DeploymentsResult | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [urls, setUrls] = React.useState<Urls | undefined>(undefined);

    useAutoResize(ready, `${!!result}|${!!error}|${(result && result.groups.length) || 0}`);

    const latestLoad = React.useRef(0);

    const load = React.useCallback(async () => {
        // The form reuses this frame across work items; a slower earlier load must not win.
        const thisLoad = ++latestLoad.current;
        try {
            const deployments = await DeploymentQueryService.getDeployments();
            if (thisLoad === latestLoad.current) {
                setError(undefined);
                setResult(deployments);
            }
        } catch (loadError: any) {
            if (thisLoad === latestLoad.current) {
                setError(loadError.message);
            }
        }
    }, []);

    React.useEffect(() => {
        let disposed = false;

        (async () => {
            await SDK.init({ loaded: false, applyTheme: true });
            await SDK.ready();

            if (!disposed) {
                setReady(true);
            }

            const { baseUrl, project } = await AzdoClient.getContext();
            // Pipelines can live in another project; its id works in place of its name.
            const base = (projectId: string) => `${baseUrl}/${encodeURIComponent(projectId || project)}`;

            if (!disposed) {
                setUrls({
                    pipelines: `${base("")}/_build`,
                    // The environment's view of this deployment, the YAML equivalent of a
                    // Classic release stage. Falls back to the run when the record id is missing.
                    deployment: (record) =>
                        record.recordId
                            ? `${base(record.projectId)}/_environments/${record.environmentId}/runs` +
                              `?environmentExecutionRecordId=${record.recordId}&ownerId=${record.runId}` +
                              `&definitionId=${record.definitionId}&planType=Build&view=jobshistory`
                            : `${base(record.projectId)}/_build/results?buildId=${record.runId}&view=results`,
                    pipeline: (pipeline) => `${base(pipeline.projectId)}/_build?definitionId=${pipeline.definitionId}`,
                });
            }

            SDK.register(SDK.getContributionId(), {
                onLoaded: () => load(),
                onSaved: () => load(),
                onRefreshed: () => load(),
                onReset: () => load(),
            } as Partial<IWorkItemNotificationListener>);

            await load();
            SDK.notifyLoadSucceeded();
        })().catch((initError: any) => {
            if (!disposed) {
                setError(initError.message);
            }
            SDK.notifyLoadFailed(initError.message);
        });

        return () => {
            disposed = true;
        };
    }, [load]);

    if (error) {
        return <div className="dsb-root dsb-error">Couldn't load deployments: {error}</div>;
    }

    if (!result || !urls) {
        return <div className="dsb-root dsb-loading">Loading deployments...</div>;
    }

    const ordered = orderGroups(result.groups);

    if (!ordered.length) {
        return (
            <div className="dsb-root">
                <EmptyState noRuns={result.noRuns} urls={urls} />
            </div>
        );
    }

    return (
        <div className="dsb-root">
            {ordered.map((group) => (
                <div className="dsb-group" key={group.deploymentType}>
                    <div className="dsb-group-title">{DEPLOYMENT_TYPE_LABELS[group.deploymentType]}</div>
                    {group.pipelines.map((pipeline) => (
                        <PipelineRow key={`${pipeline.projectId}-${pipeline.definitionId}`} pipeline={pipeline} urls={urls} />
                    ))}
                </div>
            ))}
        </div>
    );
}

ReactDOM.render(<DeploymentsGroup />, document.getElementById("root"));
