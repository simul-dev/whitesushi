/** Bundled resources follow the Vite deployment base; stored JSON stays portable. */
export const publicAsset = (name: string) =>
  `${import.meta.env.BASE_URL}${name.replace(/^\/+/, "")}`;

export const resolveOverlayUrl = (url: string) =>
  url === "/sample-plan.png" ? publicAsset("sample-plan.png") : url;
