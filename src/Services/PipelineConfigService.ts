import * as SDK from "azure-devops-extension-sdk";
import {
    CommonServiceIds,
    IExtensionDataManager,
    IExtensionDataService,
    IProjectPageService,
} from "azure-devops-extension-api";
import { PIPELINE_CONFIG_COLLECTION, PipelineConfig } from "../Contracts";
import { configsForProject } from "../Deployments";
import AzdoClient, { getAccessToken } from "./AzdoClient";

class PipelineConfigService {
    private dataManager: { manager: Promise<IExtensionDataManager>; token: Promise<string> } | undefined;

    /** The manager holds the token it was built with, so rebuild it whenever the token is refreshed. */
    private async getDataManager(): Promise<IExtensionDataManager> {
        const token = getAccessToken();
        if (!this.dataManager || this.dataManager.token !== token) {
            const manager = (async () => {
                const dataService = await SDK.getService<IExtensionDataService>(
                    CommonServiceIds.ExtensionDataService
                );
                return dataService.getExtensionDataManager(SDK.getExtensionContext().id, await token);
            })();
            this.dataManager = { manager, token };
        }
        return this.dataManager.manager;
    }

    private async documentId(definitionId: number): Promise<string> {
        const projectService = await SDK.getService<IProjectPageService>(
            CommonServiceIds.ProjectPageService
        );
        const project = await projectService.getProject();
        return `${project ? project.id : "unknown"}-${definitionId}`;
    }

    public async get(definitionId: number): Promise<PipelineConfig> {
        const manager = await this.getDataManager();
        const id = await this.documentId(definitionId);

        try {
            return await manager.getDocument(PIPELINE_CONFIG_COLLECTION, id);
        } catch {
            return { id, definitionId, enabled: false, environments: {} };
        }
    }

    public async save(config: PipelineConfig): Promise<PipelineConfig> {
        const manager = await this.getDataManager();
        return manager.setDocument(PIPELINE_CONFIG_COLLECTION, config);
    }

    public async getAll(): Promise<Map<number, PipelineConfig>> {
        const [manager, { projectId }] = await Promise.all([this.getDataManager(), AzdoClient.getContext()]);

        try {
            const documents: PipelineConfig[] = await manager.getDocuments(PIPELINE_CONFIG_COLLECTION);
            return configsForProject(documents, projectId);
        } catch {
            return new Map();
        }
    }
}

export default new PipelineConfigService();
