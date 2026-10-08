import { DeploymentRecord, PipelineConfig } from "../Contracts";
import { mappedEnvironments, projectIdOf, toDeploymentRecords } from "../Deployments";
import {
    RunCandidate,
    carriedRuns,
    codeLinksFromRelations,
    deployingBranch,
    deploymentsOfRuns,
    byBranch,
    firstContaining,
    reachedBefore,
    repositoriesOf,
    runsAfter,
} from "../EnvironmentLookup";
import PipelineConfigService from "./PipelineConfigService";
import PipelineRunService from "./PipelineRunService";

/**
 * A completed pull request links its merge commit at about the time CI queues the run, so the
 * link time can be slightly after the run's queue time. Runs this much earlier are tried too.
 */
const LINK_TIME_SLACK_MS = 60 * 60 * 1000;

/**
 * Finds a work item's deployments through the environments of the pipelines that build its code.
 *
 * Requests per work item: the deployment records of each mapped environment of the pipelines that
 * build a linked repository, back to the link; one batched build lookup for the candidate runs'
 * branches; and per branch one work item check over the whole range plus about log2(runs) more.
 */
class EnvironmentLookupService {
    public async deployments(
        workItemId: number,
        relations: any[],
        configs: Map<string, PipelineConfig>
    ): Promise<DeploymentRecord[]> {
        const repositories = repositoriesOf(codeLinksFromRelations(relations));
        if (!repositories.length) {
            return [];
        }

        const enabled = Array.from(configs.values()).filter((config) => config.enabled);
        const withRepository = await Promise.all(enabled.map((config) => this.withRepository(config)));

        const perPipeline = await Promise.all(
            withRepository.map((config) => {
                const repository = repositories.find((candidate) => candidate.repositoryId === config.repositoryId);
                if (!repository) {
                    return Promise.resolve([] as DeploymentRecord[]);
                }
                const since = Math.max(0, repository.since - LINK_TIME_SLACK_MS);
                return this.deploymentsOfPipeline(workItemId, since, config);
            })
        );

        return perPipeline.reduce((all, some) => all.concat(some), [] as DeploymentRecord[]);
    }

    /**
     * Settings saved before the repository was recorded get it from the pipeline once, and keep it
     * so later work items do not ask again.
     */
    private async withRepository(config: PipelineConfig): Promise<PipelineConfig> {
        if (config.repositoryId) {
            return config;
        }
        const repositoryId = await PipelineRunService.repositoryOf(projectIdOf(config), config.definitionId).catch(
            () => undefined
        );
        if (!repositoryId) {
            return config;
        }
        const updated = { ...config, repositoryId };
        PipelineConfigService.save(updated).catch(() => undefined);
        return updated;
    }

    private async deploymentsOfPipeline(
        workItemId: number,
        since: number,
        config: PipelineConfig
    ): Promise<DeploymentRecord[]> {
        const definitionId = config.definitionId;
        const projectId = projectIdOf(config);
        const environments = mappedEnvironments(new Map([[config.id, config]]));

        // Each mapped environment, newest first, back to the first deployment before the link.
        const records = await Promise.all(
            environments.map((environment) =>
                PipelineRunService.recordsOf(environment, (page) => reachedBefore(page, since))
            )
        );
        const candidates = runsAfter(records.reduce((a, b) => a.concat(b), []), definitionId, since);
        if (!candidates.length) {
            return [];
        }

        // One batched lookup gives every candidate's branch, deleted runs included where possible.
        const branchOf = await PipelineRunService.branchesOf(candidates.map((candidate) => candidate.runId));

        const firstRunId = await this.firstCarryingRun(workItemId, projectId, candidates, branchOf);
        if (firstRunId === undefined) {
            return [];
        }

        const runs = carriedRuns(candidates, branchOf, firstRunId);
        return environments.reduce((all, environment, index) => {
            const carried = deploymentsOfRuns(records[index], definitionId, runs);
            return all.concat(toDeploymentRecords(environment, carried, Array.from(runs)));
        }, [] as DeploymentRecord[]);
    }

    /**
     * The earliest run, on any branch, that brought the work item: found per branch by halving
     * over its runs. A branch whose runs can no longer be checked because retention deleted them
     * falls back to the rule itself on the branch the pipeline deploys from: its first run after
     * the link.
     */
    private async firstCarryingRun(
        workItemId: number,
        projectId: string,
        candidates: RunCandidate[],
        branchOf: Map<number, string>
    ): Promise<number | undefined> {
        const deploying = deployingBranch(candidates, branchOf);

        const perBranch = await Promise.all(
            byBranch(candidates, branchOf).map(async (runs) => {
                try {
                    return await firstContaining(runs, async (fromRunId, toRunId) =>
                        (await PipelineRunService.workItemsOf(projectId, toRunId, fromRunId)).includes(workItemId)
                    );
                } catch {
                    const branch = branchOf.get(runs[0].runId) || "";
                    return !deploying || branch === deploying ? runs[0].runId : undefined;
                }
            })
        );

        const found = perBranch.filter((runId): runId is number => runId !== undefined).sort((a, b) => a - b);
        return found.length ? found[0] : undefined;
    }
}

export default new EnvironmentLookupService();
