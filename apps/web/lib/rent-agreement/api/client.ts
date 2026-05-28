import { RaError } from "../errors/ra-error";

export interface ApiRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
}

export type GetToken = () => Promise<string | null>;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: GetToken
  ) {}

  async request<T>(req: ApiRequest): Promise<ApiResult<T>> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;

    const res = await fetch(`${this.baseUrl}${req.path}`, {
      method: req.method,
      headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: req.signal
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw RaError.fromResponse(res.status, json);
    }
    return json as ApiResult<T>;
  }

  /**
   * Fetch a binary response body (e.g. a PDF) as an ArrayBuffer. Same auth
   * headers as `request`, but never JSON-unwraps the success body. Errors still
   * arrive as the JSON `RENT_AGREEMENT_*` envelope, so parse + throw RaError.
   */
  async requestBytes(req: ApiRequest): Promise<ArrayBuffer> {
    const token = await this.getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${req.path}`, {
      method: req.method,
      headers,
      signal: req.signal
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw RaError.fromResponse(res.status, json);
    }
    return res.arrayBuffer();
  }
}
