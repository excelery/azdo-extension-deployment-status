import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, ILocationService, IProjectPageService } from "azure-devops-extension-api";

/** SDK access tokens expire; the iframe can outlive one on long-lived board pages. */
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

let token: { value: Promise<string>; fetchedAt: number } | undefined;

export function getAccessToken(): Promise<string> {
    if (!token || Date.now() - token.fetchedAt > TOKEN_LIFETIME_MS) {
        const value = SDK.getAccessToken();
        token = { value, fetchedAt: Date.now() };
        value.catch(() => {
            token = undefined;
        });
    }
    return token.value;
}

export interface Page<T> {
    body: T | undefined;
    continuationToken: string | undefined;
}

class AzdoClient {
    private context: Promise<{ baseUrl: string; project: string; projectId: string }> | undefined;

    public getContext(): Promise<{ baseUrl: string; project: string; projectId: string }> {
        if (!this.context) {
            this.context = (async () => {
                const [projectService, locationService] = await Promise.all([
                    SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService),
                    SDK.getService<ILocationService>(CommonServiceIds.LocationService),
                ]);
                const [project, collectionUrl] = await Promise.all([
                    projectService.getProject(),
                    // Resolves dev.azure.com, legacy visualstudio.com and Azure DevOps Server alike.
                    locationService.getServiceLocation(),
                ]);

                return {
                    baseUrl: collectionUrl.replace(/\/+$/, ""),
                    project: project ? project.name : "",
                    projectId: project ? project.id : "",
                };
            })();
            this.context.catch(() => {
                this.context = undefined;
            });
        }
        return this.context;
    }

    public async get<T>(path: string, apiVersion = "7.1"): Promise<T | undefined> {
        return (await this.getPage<T>(path, apiVersion)).body;
    }

    /** `project` is a project name or id; it defaults to the current project. */
    public async getPage<T>(path: string, apiVersion = "7.1", project?: string): Promise<Page<T>> {
        const [context, accessToken] = await Promise.all([this.getContext(), getAccessToken()]);
        const separator = path.indexOf("?") >= 0 ? "&" : "?";

        const response = await fetch(
            `${context.baseUrl}/${encodeURIComponent(project || context.project)}/${path}${separator}api-version=${apiVersion}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!response.ok) {
            if (response.status === 401) {
                token = undefined;
            }
            throw new Error(
                `${path} failed with ${response.status}` +
                    (response.status === 401 || response.status === 403
                        ? ". Check the extension is installed and authorized."
                        : "")
            );
        }

        return {
            body: await response.json(),
            continuationToken: response.headers.get("x-ms-continuationtoken") || undefined,
        };
    }
}

export default new AzdoClient();
