import { load } from "@tauri-apps/plugin-store";

/** Read a single credential value from the persistent credentials store. */
export async function getCredential(key: string): Promise<string> {
  try {
    const store = await load("credentials.json");
    const val = await store.get<string>(key);
    return val ?? "";
  } catch {
    return "";
  }
}

/** Write a single credential value to the persistent credentials store. */
export async function setCredential(key: string, value: string): Promise<void> {
  const store = await load("credentials.json");
  await store.set(key, value);
  await store.save();
}

/** Get the underlying store instance (for bulk reads). */
export async function getCredentialStore() {
  return load("credentials.json");
}
