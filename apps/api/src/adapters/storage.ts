import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export interface StoredFile {
  storage: "nextcloud" | "local";
  location: string;
}

/** Dateiablage. Dateien werden nie in der Datenbank gespeichert, nur referenziert. */
export interface FileStorage {
  readonly kind: "nextcloud" | "local";
  put(path: string, bytes: Uint8Array, mimeType: string): Promise<StoredFile>;
  get(location: string): Promise<Uint8Array>;
}

function safeRelative(path: string): string {
  // ".."-Segmente werden grundsätzlich abgelehnt, nicht nur wenn sie die Wurzel verlassen würden.
  if (path.split(/[/\\]/).includes("..") || path.includes("\0")) {
    throw new Error(`Unzulässiger Pfad: ${path}`);
  }
  return normalize(path).replace(/^([/\\])+/, "");
}

/** Lokales Verzeichnis (Entwicklung, Tests, einfache Installationen). */
export class LocalStorage implements FileStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  async put(path: string, bytes: Uint8Array, _mimeType?: string): Promise<StoredFile> {
    const rel = safeRelative(path);
    const full = join(this.root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return { storage: "local", location: `/${rel.split(sep).join("/")}` };
  }

  async get(location: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.root, safeRelative(location))));
  }
}

/** Nextcloud (oder jeder andere WebDAV-Server) mit App-Passwort. */
export class WebDavStorage implements FileStorage {
  readonly kind = "nextcloud" as const;
  private readonly auth: string;

  constructor(
    /** z. B. https://cloud.example.org/remote.php/dav/files/benutzer */
    private readonly baseUrl: string,
    user: string,
    password: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  }

  private url(path: string) {
    const rel = safeRelative(path)
      .split(/[/\\]/)
      .map((p) => encodeURIComponent(p))
      .join("/");
    return `${this.baseUrl.replace(/\/$/, "")}/${rel}`;
  }

  private async ensureFolders(path: string) {
    const parts = safeRelative(path).split(/[/\\]/).slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const res = await this.fetchImpl(this.url(parts.slice(0, i).join("/")), {
        method: "MKCOL",
        headers: { authorization: this.auth },
      });
      // 201 angelegt, 405 existiert bereits
      if (!res.ok && res.status !== 405) throw new Error(`WebDAV MKCOL ${res.status}`);
    }
  }

  async put(path: string, bytes: Uint8Array, mimeType: string): Promise<StoredFile> {
    await this.ensureFolders(path);
    const res = await this.fetchImpl(this.url(path), {
      method: "PUT",
      headers: { authorization: this.auth, "content-type": mimeType },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`WebDAV PUT ${res.status}`);
    return { storage: "nextcloud", location: `/${safeRelative(path).split(sep).join("/")}` };
  }

  async get(location: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(this.url(location), { headers: { authorization: this.auth } });
    if (!res.ok) throw new Error(`WebDAV GET ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
