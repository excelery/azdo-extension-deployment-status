import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";

import { Button } from "azure-devops-ui/Button";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Dropdown } from "azure-devops-ui/Dropdown";
import { IListBoxItem } from "azure-devops-ui/ListBox";
import { DropdownSelection } from "azure-devops-ui/Utilities/DropdownSelection";

import {
    DEPLOYMENT_TYPES,
    DEPLOYMENT_TYPE_LABELS,
    DeploymentType,
    EnvironmentMapping,
    PipelineConfig,
} from "../Contracts";
import AzdoClient from "../Services/AzdoClient";
import PipelineRunService, { EnvironmentSummary } from "../Services/PipelineRunService";
import PipelineConfigService from "../Services/PipelineConfigService";

import "azure-devops-ui/Core/override.css";
import "./PipelineSettingsPanel.scss";

const DEFAULT_MAPPING: EnvironmentMapping = { enabled: false, deploymentType: "unmapped" };

const TYPE_ITEMS: IListBoxItem<DeploymentType>[] = DEPLOYMENT_TYPES.map((type) => ({
    id: type,
    text: DEPLOYMENT_TYPE_LABELS[type],
}));

function PipelineSettingsPanel(): JSX.Element {
    const [definitionId, setDefinitionId] = React.useState(0);
    const [config, setConfig] = React.useState<PipelineConfig | undefined>(undefined);
    const [environments, setEnvironments] = React.useState<EnvironmentSummary[] | undefined>(undefined);
    const [status, setStatus] = React.useState<"loading" | "ready" | "saving" | "error">("loading");
    const [error, setError] = React.useState<string | undefined>(undefined);
    const panelRef = React.useRef<{ close?: (result?: unknown) => void } | undefined>(undefined);
    const selections = React.useRef(new Map<string, DropdownSelection>());

    React.useEffect(() => {
        (async () => {
            await SDK.init({ loaded: false, applyTheme: true });
            await SDK.ready();
            // Show the panel straight away; finding the pipeline's environments reads
            // deployment history for every environment and can take a while.
            SDK.notifyLoadSucceeded();

            const configuration = SDK.getConfiguration() as any;
            panelRef.current = configuration && configuration.panel;
            const id = Number(configuration && configuration.definitionId) || 0;
            setDefinitionId(id);

            if (!id) {
                throw new Error(
                    "No pipeline selected."
                );
            }

            const environmentsLoad = PipelineRunService.environmentsForPipeline(id);

            setConfig(await PipelineConfigService.get(id));
            setStatus("ready");

            setEnvironments(await environmentsLoad);
        })().catch((loadError: any) => {
            setError(loadError.message);
            setStatus("error");
        });
    }, []);

    const mappingFor = (environmentId: number): EnvironmentMapping =>
        (config && config.environments[String(environmentId)]) || DEFAULT_MAPPING;

    const selectionFor = (environmentId: number, deploymentType: DeploymentType): DropdownSelection => {
        const key = String(environmentId);
        let selection = selections.current.get(key);
        if (!selection) {
            selection = new DropdownSelection();
            selection.select(Math.max(0, DEPLOYMENT_TYPES.indexOf(deploymentType)));
            selections.current.set(key, selection);
        }
        return selection;
    };

    const setMapping = (environmentId: number, changes: Partial<EnvironmentMapping>) => {
        setConfig((current) => {
            if (!current) {
                return current;
            }
            const key = String(environmentId);
            const existing = current.environments[key] || DEFAULT_MAPPING;
            return {
                ...current,
                environments: { ...current.environments, [key]: { ...existing, ...changes } },
            };
        });
    };

    const save = async () => {
        if (!config) {
            return;
        }

        setStatus("saving");
        try {
            const stamped = { ...config.environments };
            for (const environment of environments || []) {
                const key = String(environment.environmentId);
                if (stamped[key]) {
                    stamped[key] = { ...stamped[key], environmentName: environment.environmentName };
                }
            }

            const { projectId } = await AzdoClient.getContext();
            const repositoryId = await PipelineRunService.repositoryOf(projectId, definitionId).catch(
                () => config.repositoryId
            );
            const saved = await PipelineConfigService.save({
                ...config,
                definitionId,
                repositoryId,
                environments: stamped,
            });
            setConfig(saved);
            setStatus("ready");

            const panel = panelRef.current;
            if (panel && typeof panel.close === "function") {
                panel.close(saved);
            }
        } catch (saveError: any) {
            setError(saveError.message);
            setStatus("error");
        }
    };

    const canSave =
        status === "ready" &&
        !!config &&
        (!config.enabled || (!!environments && environments.length > 0));

    return (
        <div className="dsb-panel">
            <div className="dsb-content">
                {status === "loading" && <div>Loading…</div>}

                {status === "error" && (
                    <div className="dsb-panel-error">Couldn't load settings: {error}</div>
                )}

                {config && status !== "loading" && status !== "error" && (
                    <>
                        <Checkbox
                            checked={config.enabled}
                            onChange={(_event, checked) => setConfig({ ...config, enabled: checked })}
                            label="Show deployments on linked work items"
                        />

                        {config.enabled && (
                            <>
                                <div className="dsb-table">
                                    <div className="dsb-table-head">
                                        <span className="dsb-col-environment">Environment</span>
                                        <span className="dsb-col-type">Deployment type</span>
                                    </div>

                                    {!environments && <div className="dsb-note">Loading environments…</div>}

                                    {environments && environments.length === 0 && (
                                        <div className="dsb-note">
                                            This pipeline hasn't deployed to an environment yet.
                                        </div>
                                    )}

                                    {(environments || []).map((environment) => {
                                        const mapping = mappingFor(environment.environmentId);
                                        return (
                                            <div className="dsb-table-row" key={environment.environmentId}>
                                                <div className="dsb-col-environment">
                                                    <Checkbox
                                                        checked={mapping.enabled}
                                                        onChange={(_event, checked) =>
                                                            setMapping(environment.environmentId, {
                                                                enabled: checked,
                                                                environmentName: environment.environmentName,
                                                            })
                                                        }
                                                        label={environment.environmentName}
                                                    />
                                                </div>
                                                <div className="dsb-col-type">
                                                    <Dropdown<DeploymentType>
                                                        items={TYPE_ITEMS}
                                                        selection={selectionFor(
                                                            environment.environmentId,
                                                            mapping.deploymentType
                                                        )}
                                                        disabled={!mapping.enabled}
                                                        onSelect={(_event, item) =>
                                                            setMapping(environment.environmentId, {
                                                                deploymentType: item.id as DeploymentType,
                                                                environmentName: environment.environmentName,
                                                            })
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {environments && environments.length > 0 && (
                                    <div className="dsb-note">
                                        Work items need to be linked to a run. Turn on{" "}
                                        <strong>Automatically link work items included in this run</strong> in
                                        the pipeline's <strong>Settings</strong>.
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            <div className="dsb-actions">
                <Button
                    primary={true}
                    text={status === "saving" ? "Saving…" : "Save"}
                    onClick={save}
                    disabled={!canSave}
                />
            </div>
        </div>
    );
}

ReactDOM.render(<PipelineSettingsPanel />, document.getElementById("root"));
