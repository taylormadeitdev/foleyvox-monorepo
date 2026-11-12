const SUPABASE_URL = "https://agxbclksvulruxocqyiq.supabase.co";
const SUPABASE_KEY = "sb_publishable_Jgrausgzfmt4FHkstpukqw_2yyaIJ7U";
const API_BASE = "https://foleyvox-api.onrender.com";
const SESSION_KEY = "foleyvox.supabase.session";

export type FoleySession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: { id: string; email?: string };
};

async function supabaseFetch(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.text();
  const data = body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : null;
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `Supabase request failed (${response.status})`);
  return data;
}

function saveSession(session: FoleySession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function apiFetch(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try { const parsed = JSON.parse(body); message = parsed.error || parsed.message || body; } catch { /* keep response text */ }
    throw new Error(message || `FoleyVox API request failed (${response.status})`);
  }
  return response;
}

export const foleyvoxApi = {
  async getSession(): Promise<FoleySession | null> {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    let session: FoleySession;
    try { session = JSON.parse(raw); } catch { saveSession(null); return null; }
    if (session.expires_at && session.expires_at * 1000 > Date.now() + 60_000) return session;
    if (!session.refresh_token) { saveSession(null); return null; }
    try {
      const refreshed = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      const next = { ...refreshed, expires_at: Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600) } as FoleySession;
      saveSession(next);
      return next;
    } catch { saveSession(null); return null; }
  },
  async signIn(email: string, password: string): Promise<FoleySession> {
    const data = await supabaseFetch("/auth/v1/token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    const session = { ...data, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) } as FoleySession;
    saveSession(session);
    return session;
  },
  async signUp(email: string, password: string): Promise<FoleySession | null> {
    const data = await supabaseFetch("/auth/v1/signup", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    if (!data.access_token) return null;
    const session = { ...data, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) } as FoleySession;
    saveSession(session);
    return session;
  },
  async signOut(token: string) {
    try { await supabaseFetch("/auth/v1/logout", { method: "POST" }, token); } finally { saveSession(null); }
  },
  async listProjects(token: string) {
    return supabaseFetch("/rest/v1/projects?select=*&order=created_at.desc", {}, token) as Promise<any[]>;
  },
  async createProject(token: string, userId: string, title: string) {
    const rows = await supabaseFetch("/rest/v1/projects?select=*", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, title, status: "uploaded" }),
    }, token);
    if (!rows?.[0]) throw new Error("Supabase did not return the new project.");
    return rows[0];
  },
  async uploadManuscript(token: string, userId: string, projectId: string, file: File) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const requestedPath = `${userId}/${projectId}/${Date.now()}-${safeName}`;
    const storageResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/manuscripts/${requestedPath.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": file.type || "text/plain", "x-upsert": "false" },
      body: file,
    });
    const storageBody = await storageResponse.clone().text();
    if (!storageResponse.ok) {
      throw new Error(storageBody || `Manuscript storage upload failed (${storageResponse.status})`);
    }
    let storageResult: any = null;
    try { storageResult = storageBody ? JSON.parse(storageBody) : null; } catch { /* successful HTTP response is sufficient */ }
    // Supabase Storage commonly returns { Key: "bucket/object" }, but the
    // response shape can vary by Storage API version. We already know the
    // exact object key used in the successful PUT/POST request, so do not
    // block queueing just because the response omits Key/path.
    const returnedKey = String(storageResult?.Key || storageResult?.key || storageResult?.path || "");
    const normalizedReturnedKey = returnedKey.startsWith("manuscripts/") ? returnedKey.slice("manuscripts/".length) : returnedKey;
    const manuscriptPath = normalizedReturnedKey || requestedPath;
    console.info("[FoleyVox] Supabase manuscript upload confirmed", { status: storageResponse.status, response: storageResult ?? storageBody, requested_path: requestedPath, manuscript_path: manuscriptPath });
    const apiResponse = await apiFetch("/api/upload", token, {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, manuscript_path: manuscriptPath }),
    });
    const apiResponseBody = await apiResponse.clone().text();
    let apiResponseData: any = apiResponseBody;
    try { apiResponseData = apiResponseBody ? JSON.parse(apiResponseBody) : null; } catch { /* keep raw response text */ }
    const apiResponseDetails = {
      status: apiResponse.status, statusText: apiResponse.statusText, ok: apiResponse.ok,
      headers: Object.fromEntries(apiResponse.headers.entries()), body: apiResponseData,
    };
    console.info("[FoleyVox] POST /api/upload response", apiResponseDetails);
    if (!apiResponse.ok) {
      throw new Error(typeof apiResponseData === "string" ? apiResponseData : apiResponseData?.error || apiResponseData?.message || `FoleyVox upload API failed (${apiResponse.status})`);
    }
    return manuscriptPath;
  },
  async getStudio(token: string, projectId: string, chapterNumber: number) {
    const response = await apiFetch(`/api/studio/${encodeURIComponent(projectId)}/${chapterNumber}`, token);
    return response.json();
  },
  async getProject(token: string, projectId: string) {
    // Prefer the API's enriched response (including signed audio URLs), but
    // fall back to Supabase rows if the API response is incomplete while the
    // worker has already finished writing chapters.
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, token);
      const data = await response.json();
      if (data?.project && Array.isArray(data?.chapters)) return data;
    } catch (error) {
      console.warn('[FoleyVox] Project API poll failed; checking Supabase directly.', error);
    }
    const [projects, chapters] = await Promise.all([
      supabaseFetch(`/rest/v1/projects?select=*&id=eq.${encodeURIComponent(projectId)}&limit=1`, {}, token),
      supabaseFetch(`/rest/v1/chapters?select=*&project_id=eq.${encodeURIComponent(projectId)}&order=chapter_number.asc`, {}, token),
    ]);
    if (!projects?.[0]) throw new Error('This project could not be found. Please return to Projects and try again.');
    return { project: projects[0], chapters: Array.isArray(chapters) ? chapters : [] };
  },
  async getProjectDirect(token: string, projectId: string) {
    // Deliberately bypass the Render API: the browser reads the authoritative
    // project and chapter rows from Supabase for upload completion detection.
    const [projects, chapters] = await Promise.all([
      supabaseFetch(`/rest/v1/projects?select=*&id=eq.${encodeURIComponent(projectId)}&limit=1`, {}, token),
      supabaseFetch(`/rest/v1/chapters?select=*&project_id=eq.${encodeURIComponent(projectId)}&order=chapter_number.asc`, {}, token),
    ]);
    if (!projects?.[0]) throw new Error('Supabase returned no project row. Check that the signed-in user owns this project and that the projects SELECT policy allows authenticated users to read it.');
    return { project: projects[0], chapters: Array.isArray(chapters) ? chapters : [] };
  },
  async saveChapterBlueprint(token: string, chapterId: string, blueprint: any) {
    return supabaseFetch(`/rest/v1/chapters?id=eq.${encodeURIComponent(chapterId)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ json_blueprint: blueprint }),
    }, token);
  },
  async updateChapterTitle(token: string, chapterId: string, title: string) {
    return supabaseFetch(`/rest/v1/chapters?id=eq.${encodeURIComponent(chapterId)}`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ title }),
    }, token);
  },
  async previewVoice(token: string, voice: string, text: string) {
    return apiFetch("/api/preview_voice", token, { method: "POST", body: JSON.stringify({ voice, text }) });
  },
  async rerender(token: string, projectId: string, chapterNumber: number) {
    const response = await apiFetch("/api/rerender", token, { method: "POST", body: JSON.stringify({ project_id: projectId, chapter_number: chapterNumber }) });
    return response.json();
  },
};
