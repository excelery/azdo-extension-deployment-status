import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, IHostPageLayoutService } from "azure-devops-extension-api";

function resolveDefinitionId(actionContext: any): number {
    const candidates = [
        actionContext && actionContext.definitionId,
        actionContext && actionContext.pipeline && actionContext.pipeline.id,
        actionContext && actionContext.definition && actionContext.definition.id,
        actionContext && actionContext.id,
    ];

    for (const candidate of candidates) {
        const id = Number(candidate);
        if (id) {
            return id;
        }
    }

    return 0;
}

SDK.init({ loaded: false });

SDK.ready().then(() => {
    SDK.register("pipeline-settings-menu-action", {
        execute: async (actionContext: any) => {
            const definitionId = resolveDefinitionId(actionContext);
            const layoutService = await SDK.getService<IHostPageLayoutService>(
                CommonServiceIds.HostPageLayoutService
            );

            layoutService.openPanel(
                `${SDK.getExtensionContext().id}.pipeline-settings-panel`,
                {
                    title: "Boards Integration",
                    description:
                        "Choose which environments report deployment status to Boards.",
                    size: 1,
                    configuration: { definitionId },
                    onClose: () => {
                    },
                }
            );
        },
    });

    SDK.notifyLoadSucceeded();
});
