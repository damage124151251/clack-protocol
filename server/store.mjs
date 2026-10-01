import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { get, put } from "@vercel/blob";
import { initialState } from "./config.mjs";
const path = "clack/state-v1.json",
  file = new URL("../.local/state.json", import.meta.url);
let queue = Promise.resolve();
export async function readRemote(reader = get) {
  // Keep the strong object ETag; transparent compression makes CAS tokens unusable.
  const r = await reader(path, {
    access: "private",
    useCache: false,
    headers: { "Accept-Encoding": "identity" },
  });
  if (!r) return { data: initialState() };
  if (!/^"[^"\r\n]+"$/.test(r.blob.etag))
    throw new Error("Storage version token unavailable.");
  return { data: await new Response(r.stream).json(), etag: r.blob.etag };
}
export async function readState() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return readRemote();
  if (process.env.VERCEL) throw new Error("Durable storage is unavailable.");
  try {
    return { data: JSON.parse(await readFile(file, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return { data: initialState() };
  }
}
export function updateState(fn) {
  const work = queue
    .catch(() => {})
    .then(async () => {
      for (let retry = 0; retry < 5; retry++) {
        const current = await readState(),
          next = await fn(structuredClone(current.data));
        if (!next) return current.data;
        try {
          if (process.env.BLOB_READ_WRITE_TOKEN)
            await put(path, JSON.stringify(next), {
              access: "private",
              addRandomSuffix: false,
              contentType: "application/json",
              ...(current.etag
                ? { ifMatch: current.etag }
                : { allowOverwrite: false }),
            });
          else {
            await mkdir(new URL("../.local/", import.meta.url), {
              recursive: true,
            });
            await writeFile(
              new URL("../.local/state.tmp", import.meta.url),
              JSON.stringify(next),
            );
            await rename(new URL("../.local/state.tmp", import.meta.url), file);
          }
          return next;
        } catch (e) {
          if (retry === 4 || !/precondition|already exists/i.test(e.message))
            throw e;
        }
      }
    });
  queue = work;
  return work;
}
