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

type Status = "succeeded" | "failed" | "neutral" | "inProgress";

const STATUS: Record<DeploymentRecord["result"], { status: Status; label: string }> = {
    succeeded: { status: "succeeded", label: "Succeeded" },
    partiallySucceeded: { status: "succeeded", label: "Partially succeeded" },
    failed: { status: "failed", label: "Failed" },
    canceled: { status: "neutral", label: "Canceled" },
    skipped: { status: "neutral", label: "Skipped" },
    inProgress: { status: "inProgress", label: "In progress" },
    unknown: { status: "neutral", label: "Unknown" },
};

const ICON_FILL: Record<Status, string> = {
    succeeded: "#107C10",
    failed: "#CD4A45",
    neutral: "#8A8886",
    inProgress: "#0078D4",
};

const ICON_PATH: Record<Status, string> = {
    succeeded: "M6.7 11.3 3.9 8.5l1-1 1.8 1.8 4.4-4.4 1 1z",
    failed: "M11.1 6 9.1 8l2 2-1.1 1.1-2-2-2 2L4.9 10l2-2-2-2L6 4.9l2 2 2-2z",
    neutral: "M4.5 7.25h7v1.5h-7z",
    inProgress: "M7.25 4h1.5v3.7l2.6 1.5-.75 1.3-3.35-1.95z",
};

function StatusIcon(props: { result: DeploymentRecord["result"] }): JSX.Element {
    const { status, label } = STATUS[props.result] || STATUS.unknown;

    return (
        <svg
            className="dsb-status"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            role="img"
            aria-label={label}
            focusable="false"
        >
            <title>{label}</title>
            <circle cx="8" cy="8" r="8" fill={ICON_FILL[status]} />
            <path d={ICON_PATH[status]} fill="#FFFFFF" />
        </svg>
    );
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
                        {relativeTime(latest.finishTime)} on {latest.environmentName || latest.stageName}
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
                    {pipeline.history.map((record, index) => (
                        <div
                            className="dsb-run"
                            // A rerun stage deploys the same run to the same environment again.
                            key={`${record.runId}-${record.environmentId}-${record.stageName}-${record.finishTime}-${index}`}
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
