import type * as OpenCv from "@techstark/opencv-js";

export type Cv = typeof OpenCv;

let loading: Promise<{ cv: Cv }> | undefined;

/** The WebAssembly module loads once per process; the wrapper keeps the thenable module from being re-adopted. */
export async function loadOpenCv(): Promise<Cv> {
  loading ??= import("@techstark/opencv-js").then(async (module) => {
    const ready = (module as unknown as { default: PromiseLike<Cv> }).default;

    return { cv: await ready };
  });

  const { cv } = await loading;

  return cv;
}
