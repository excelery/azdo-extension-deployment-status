import { DeploymentRecord, PipelineConfig } from "../Contracts";
import { mappedEnvironments, pipelineKey, toDeploymentRecords } from "../Deployments";
import { commitLinksFromRelations, deploymentsFrom, reachedBefore, repositoriesOf, runsAfter } from "../EnvironmentLookup";
import AzdoClient from "./AzdoClient";
import PipelineRunService from "./PipelineRunService";

/** Runs after the commit to try before giving up on a pipeline. */
const CANDIDATE_RUNS = 3;
/**
 * A completed pull request links its merge commit at about the time CI queues the run, so the
 * link time can be slightly after the run's queue time. Runs this much earlier are tried too.
 */
const LINK_TIME_SLACK_MS = 60 * 60 * 1000;

/**
 * Finds a work item's deployments through the environments of the pipelines that build its code.
 *
 * Requests per work item: one pipeline list per repository the work item has commits in, the
 * deployment records of each mapped environment back to the commit, and usually one work item
 * check per pipeline.
 */
class EnvironmentLookupService {
    public async deployments(
        workItemId: number,
        relations: any[],
        configs: Map<string, PipelineConfig>
    ): Promise<DeploymentRecord[]> {
        const repositories = repositoriesOf(commitLinksFromRelations(relations));

        const perRepository = await Promise.all(
            repositories.map(async (repository) => {
                // Pipelines that build this repository, in the repository's project.
                const definitions = await AzdoClient.get<{ value: { id: number }[] }>(
                    `_apis/build/definitions?repositoryId=${repository.repositoryId}&repositoryType=TfsGit`,
                    "7.1",
                    repository.projectId
                ).catch(() => undefined);

                const perPipeline = await Promise.all(
                    ((definitions && definitions.value) || []).map(async (definition) => {
                        const config = configs.get(pipelineKey(repository.projectId, definition.id));
                        if (!config || !config.enabled) {
                            return [];
                        }
                        const since = Math.max(0, repository.since - LINK_TIME_SLACK_MS);
                        return this.deploymentsOfPipeline(workItemId, since, config, definition.id);
                    })
                );
                return perPipeline.reduce((all, some) => all.concat(some), [] as DeploymentRecord[]);
            })
        );

        return perRepository.reduce((all, some) => all.concat(some), [] as DeploymentRecord[]);
    }

    private async deploymentsOfPipeline(
        workItemId: number,
        since: number,
        config: PipelineConfig,
        definitionId: number
    ): Promise<DeploymentRecord[]> {
        const environments = mappedEnvironments(new Map([[config.id, config]]));
        const projectId = environments.length ? environments[0].projectId || "" : "";

        // Each mapped environment, newest first, back to the first deployment before the commit.
        const records = await Promise.all(
            environments.map((environment) =>
                PipelineRunService.recordsOf(environment, (page) => reachedBefore(page, since))
            )
        );

        // The first run after the commit that brought the work item.
        let firstRunId: number | undefined;
        for (const candidate of runsAfter(records.reduce((a, b) => a.concat(b), []), definitionId, since, CANDIDATE_RUNS)) {
            const workItems = await PipelineRunService.workItemsOf(projectId, candidate.runId, candidate.previousRunId).catch(
                () => [] as number[]
            );
            if (workItems.includes(workItemId)) {
                firstRunId = candidate.runId;
                break;
            }
        }
        if (firstRunId === undefined) {
            return [];
        }

        // Every deployment of that run or a later one carries the work item.
        return environments.reduce((all, environment, index) => {
            const carried = deploymentsFrom(records[index], definitionId, firstRunId!);
            return all.concat(
                toDeploymentRecords(
                    environment,
                    carried,
                    carried.map((record) => record.owner!.id)
                )
            );
        }, [] as DeploymentRecord[]);
    }
}

export default new EnvironmentLookupService();
