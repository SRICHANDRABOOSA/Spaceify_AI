import puter from "@heyputer/puter.js";
import {
  createHostingSlug,
  fetchBlobFromUrl,
  getHostedUrl,
  getImageExtension,
  HOSTING_CONFIG_KEY,
  imageUrlToPngBlob,
  isHostedUrl,
} from "./utils";

export const getOrCreateHostingConfig =
  async (): Promise<HostingConfig | null> => {
    const existing = (await puter.kv.get(
      HOSTING_CONFIG_KEY,
    )) as HostingConfig | null;

    if (existing?.subdomain) return { subdomain: existing.subdomain };

    const subdomain = createHostingSlug();

    try {
      const created = await puter.hosting.create(subdomain, ".");

      const record = { subdomain: created.subdomain };

      await puter.kv.set(HOSTING_CONFIG_KEY, record);

      return record;
    } catch (e) {
      console.warn(`Could not find subdomain: ${e}`);
      return null;
    }
  };

export const uploadImageToHosting = async ({
  hosting,
  url,
  projectId,
  label,
}: StoreHostedImageParams): Promise<HostedAsset | null> => {
  console.log("[HostingUpload] Upload requested", {
    projectId,
    label,
    hasHosting: !!hosting,
    hasUrl: !!url,
  });

  if (!hosting || !url) return null;
  if (isHostedUrl(url)) {
    console.log("[HostingUpload] URL already hosted; skipping upload", {
      projectId,
      label,
      url,
    });
    return { url };
  }

  try {
    console.log("[HostingUpload] Resolving source blob", {
      projectId,
      label,
    });

    const resolved =
      label === "rendered"
        ? await imageUrlToPngBlob(url).then((blob) =>
            blob ? { blob, contentType: "image/png" } : null,
          )
        : await fetchBlobFromUrl(url);

    if (!resolved) {
      console.warn("[HostingUpload] Failed to resolve source blob", {
        projectId,
        label,
      });
      return null;
    }

    const contentType = resolved.contentType || resolved.blob.type || "";
    const ext = getImageExtension(contentType, url);
    const dir = `projects/${projectId}`;
    const filePath = `${dir}/${label}.${ext}`;

    console.log("[HostingUpload] Preparing file for storage", {
      projectId,
      label,
      contentType,
      extension: ext,
      filePath,
    });

    const uploadFile = new File([resolved.blob], `${label}.${ext}`, {
      type: contentType,
    });

    console.log("[HostingUpload] Writing file to puter fs", {
      projectId,
      label,
      dir,
      filePath,
      size: resolved.blob.size,
    });

    await puter.fs.mkdir(dir, { createMissingParents: true });
    await puter.fs.write(filePath, uploadFile);

    const hostedUrl = getHostedUrl({ subdomain: hosting.subdomain }, filePath);

    console.log("[HostingUpload] Upload write completed", {
      projectId,
      label,
      hostedUrl,
    });

    return hostedUrl ? { url: hostedUrl } : null;
  } catch (e) {
    console.warn(`Failed to store hosted image: ${e}`);
    return null;
  }
};
