import puter from "@heyputer/puter.js";
import {
  getOrCreateHostingConfig,
  uploadImageToHosting,
} from "./puter.hosting";
import { isHostedUrl } from "./utils";
import { PUTER_WORKER_URL } from "./Constants";

const WORKER_FILE_NAME = "spaceify-worker.js";
const WORKER_NAME = "spaceify-ai-worker";
const WORKER_VERSION_KEY = "spaceify_ai_worker_version";
const WORKER_CODE_VERSION = "2026-04-25-save-error-fix";

let cachedWorkerUrl: string | null = null;
let workerUrlPromise: Promise<string | null> | null = null;

// Worker code as a string - must match puter.worker.js exactly
const WORKER_CODE = `const PROJECT_PREFIX = "spaceify_ai_project_";

const jsonError = (status, message, extra = {}) => {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

const getUserId = async (userPuter) => {
  try {
    const user = await userPuter.auth.getUser();
    return user?.uuid || null;
  } catch {
    return null;
  }
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return error ? String(error) : "Unknown error";
};

router.post("/api/projects/save", async ({ request, user }) => {
  try {
    const userPuter = user.puter;

    if (!userPuter) return jsonError(401, "Authentication failed");

    const body = await request.json();
    const project = body?.project;

    if (!project?.id || !project?.sourceImage) {
      return jsonError(400, "Project ID and source image are required");
    }

    const payload = {
      ...project,
      updatedAt: new Date().toISOString(),
    };

    const userId = await getUserId(userPuter);
    if (!userId) return jsonError(401, "Authentication failed");

    const key = \`\${PROJECT_PREFIX}\${project.id}\`;
    await userPuter.kv.set(key, payload);

    return { saved: true, id: project.id, project: payload };
  } catch (error) {
    return jsonError(500, "Failed to save project", {
      message: getErrorMessage(error),
    });
  }
});

router.get("/api/projects/list", async ({ user }) => {
  try {
    const userPuter = user.puter;

    if (!userPuter) return jsonError(401, "Authentication failed");

    const userId = await getUserId(userPuter);
    if (!userId) return jsonError(401, "Authentication failed");

    const projects = (await userPuter.kv.list(PROJECT_PREFIX, true)).map(
      ({ value }) => ({ ...value, isPublic: true }),
    );

    return { projects };
  } catch (error) {
    return jsonError(500, "Failed to list projects", {
      message: getErrorMessage(error),
    });
  }
});

router.get("/api/projects/get", async ({ request, user }) => {
  try {
    const userPuter = user.puter;

    if (!userPuter) return jsonError(401, "Authentication failed");

    const userId = await getUserId(userPuter);
    if (!userId) return jsonError(401, "Authentication failed");

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) return jsonError(400, "Project ID is required");

    const key = \`\${PROJECT_PREFIX}\${id}\`;
    const project = await userPuter.kv.get(key);

    if (!project) return jsonError(404, "Project not found");

    return { project };
  } catch (error) {
    return jsonError(500, "Failed to get project", {
      message: getErrorMessage(error),
    });
  }
});`;

type PuterWorkerInfo = {
  name?: string;
  url?: string;
};

type EnsureWorkerOptions = {
  forceRedeploy?: boolean;
};

const deployWorker = async (
  existingWorker?: PuterWorkerInfo,
): Promise<string> => {
  await puter.fs.write(WORKER_FILE_NAME, WORKER_CODE);
  console.log("Worker file written");

  let deployment;

  try {
    deployment = await puter.workers.create(WORKER_NAME, WORKER_FILE_NAME);
  } catch (createError) {
    if (!existingWorker) throw createError;

    console.warn(
      "Worker create failed for existing worker; recreating worker:",
      createError,
    );
    await puter.workers.delete(WORKER_NAME);
    deployment = await puter.workers.create(WORKER_NAME, WORKER_FILE_NAME);
  }

  if (!deployment?.success || !deployment?.url) {
    const deploymentErrors = Array.isArray(deployment?.errors)
      ? deployment.errors.join(", ")
      : deployment?.errors || "Unknown error";

    throw new Error(
      `Worker deployment failed: ${deploymentErrors}`,
    );
  }

  cachedWorkerUrl = deployment.url;

  try {
    await puter.kv.set(WORKER_VERSION_KEY, WORKER_CODE_VERSION);
  } catch (versionError) {
    console.warn("Failed to store worker version marker:", versionError);
  }

  return deployment.url;
};

const syncWorker = async ({
  forceRedeploy = false,
}: EnsureWorkerOptions = {}): Promise<string | null> => {
  try {
    const workers = await puter.workers.list();
    const existingWorker = workers.find(
      (worker: PuterWorkerInfo) => worker.name === WORKER_NAME,
    );
    let deployedVersion: unknown = null;

    try {
      deployedVersion = await puter.kv.get(WORKER_VERSION_KEY);
    } catch (versionError) {
      console.warn("Failed to read worker version marker:", versionError);
    }

    if (
      existingWorker?.url &&
      deployedVersion === WORKER_CODE_VERSION &&
      !forceRedeploy
    ) {
      console.log("Worker already exists:", existingWorker.url);
      cachedWorkerUrl = existingWorker.url;
      return existingWorker.url;
    }

    console.log(
      existingWorker
        ? "Redeploying stale worker..."
        : "Creating new worker...",
    );

    const workerUrl = await deployWorker(existingWorker);
    console.log("Worker deployed successfully:", workerUrl);
    return workerUrl;
  } catch (error) {
    console.error("Failed to ensure worker exists:", error);
    return null;
  }
};

// Check if worker exists and redeploy it when the bundled code has changed.
export const ensureWorkerExists = async (
  options: EnsureWorkerOptions = {},
): Promise<string | null> => {
  if (cachedWorkerUrl && !options.forceRedeploy) return cachedWorkerUrl;
  if (workerUrlPromise && !options.forceRedeploy) return workerUrlPromise;

  workerUrlPromise = syncWorker(options).finally(() => {
    workerUrlPromise = null;
  });

  return workerUrlPromise;
};

const resolveWorkerUrl = async () => {
  const workerUrl = await ensureWorkerExists();
  if (workerUrl) return workerUrl;

  return PUTER_WORKER_URL || null;
};

const buildWorkerEndpoint = (baseUrl: string, path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/+$/, "")}${normalizedPath}`;
};

export const signIn = async () => await puter.auth.signIn();

export const signOut = () => puter.auth.signOut();

export const getCurrentUser = async () => {
  try {
    return await puter.auth.getUser();
  } catch {
    return null;
  }
};

export const createProject = async ({
  item,
  visibility = "private",
}: CreateProjectParams): Promise<DesignItem | null | undefined> => {
  const workerBaseUrl = await resolveWorkerUrl();

  if (!workerBaseUrl) {
    console.error("Missing Puter worker URL; cannot save project");
    return null;
  }

  const projectId = item.id;

  console.log("Creating project:", { projectId, hasSource: !!item.sourceImage, hasRendered: !!item.renderedImage });

  const hosting = await getOrCreateHostingConfig();
  console.log("Hosting config:", hosting);

  if (!hosting) {
    console.error("Failed to get or create hosting config; cannot save project");
    return null;
  }

  const hostedSource = projectId
    ? await uploadImageToHosting({
        hosting,
        url: item.sourceImage,
        projectId,
        label: "source",
      })
    : null;

  const hostedRender =
    projectId && item.renderedImage
      ? await uploadImageToHosting({
          hosting,
          url: item.renderedImage,
          projectId,
          label: "rendered",
        })
      : null;

  const resolvedSource = hostedSource?.url || item.sourceImage;

  if (!hostedSource?.url && !isHostedUrl(item.sourceImage)) {
    console.warn(
      "Failed to host source image; using local data URL fallback for project save.",
    );
  }

  const resolvedRender = hostedRender?.url || item.renderedImage || undefined;

  const {
    sourcePath: _sourcePath,
    renderedPath: _renderedPath,
    publicPath: _publicPath,
    ...rest
  } = item;

  const payload = {
    ...rest,
    sourceImage: resolvedSource,
    renderedImage: resolvedRender,
  };

  console.log("Saving project payload:", {
    projectId: payload.id,
    sourceImageLength: resolvedSource?.length,
    renderedImageLength: resolvedRender?.length,
  });

  try {
    const workerUrl = buildWorkerEndpoint(workerBaseUrl, "/api/projects/save");
    console.log("Calling worker:", workerUrl);

    const response = await puter.workers.exec(
      workerUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: payload, visibility }),
      },
    );

    console.log("Worker response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("failed to save the project", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return null;
    }

    const data = (await response.json()) as { project?: DesignItem | null };
    console.log("Worker response data:", data);

    if (!data?.project) {
      console.warn("Project save returned no project data", data);
      return null;
    }

    return data.project;
  } catch (e) {
    console.error("Failed to save project - exception:", {
      error: e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    return null;
  }
};

export const getProjects = async () => {
  const workerBaseUrl = await resolveWorkerUrl();

  if (!workerBaseUrl) {
    console.warn("Missing Puter worker URL; skip history fetch.");
    return [];
  }

  try {
    const response = await puter.workers.exec(
      buildWorkerEndpoint(workerBaseUrl, "/api/projects/list"),
      { method: "GET" },
    );

    if (!response.ok) {
      console.error("Failed to fetch history", await response.text());
      return [];
    }

    const data = (await response.json()) as { projects?: DesignItem[] | null };
    return Array.isArray(data?.projects) ? data?.projects : [];
  } catch (e) {
    console.error("Failed to get projects", e);
    return [];
  }
};

export const getProjectById = async ({ id }: { id: string }) => {
  const workerBaseUrl = await resolveWorkerUrl();

  if (!workerBaseUrl) {
    console.warn("Missing Puter worker URL; skipping project fetch.");
    return null;
  }

  try {
    const response = await puter.workers.exec(
      buildWorkerEndpoint(
        workerBaseUrl,
        `/api/projects/get?id=${encodeURIComponent(id)}`,
      ),
      { method: "GET" },
    );

    if (!response.ok) {
      console.error("Failed to fetch project:", await response.text());
      return null;
    }

    const data = (await response.json()) as { project?: DesignItem | null };
    return data?.project ?? null;
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return null;
  }
};
