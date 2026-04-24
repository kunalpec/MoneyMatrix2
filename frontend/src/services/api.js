const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000/api/v1";

let refreshPromise = null;
const inFlightGetRequests = new Map();

export class ApiClientError extends Error {
  constructor(message, statusCode, payload) {
    super(message);
    this.name = "ApiClientError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

const safeParseJson = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const buildHeaders = (token, headers) => {
  const finalHeaders = { ...headers };

  if (!finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }

  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  return finalHeaders;
};

const refreshAccessTokenRequest = async (onAccessToken) => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/users/refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({}),
      });

      const payload = await safeParseJson(response);

      if (!response.ok) {
        throw new ApiClientError(
          payload?.message || "Session expired",
          response.status,
          payload
        );
      }

      const newAccessToken = payload?.data?.accessToken || "";
      onAccessToken?.(newAccessToken);
      return newAccessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

export const apiRequest = async (
  path,
  { method = "GET", body, token, headers = {}, retryAuth = true, onAccessToken } = {}
) => {
  const normalizedMethod = method.toUpperCase();
  const requestKey =
    normalizedMethod === "GET" ? `${normalizedMethod}:${path}:${token || ""}` : null;

  if (requestKey && inFlightGetRequests.has(requestKey)) {
    return inFlightGetRequests.get(requestKey);
  }

  const requestPromise = (async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: normalizedMethod,
      headers: buildHeaders(token, headers),
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await safeParseJson(response);

    if (response.status === 401 && retryAuth) {
      const refreshedToken = await refreshAccessTokenRequest(onAccessToken);
      return apiRequest(path, {
        method: normalizedMethod,
        body,
        token: refreshedToken,
        headers,
        retryAuth: false,
        onAccessToken,
      });
    }

    if (!response.ok) {
      throw new ApiClientError(
        payload?.message || "Request failed",
        response.status,
        payload
      );
    }

    return payload;
  })();

  if (requestKey) {
    inFlightGetRequests.set(requestKey, requestPromise);
    requestPromise.finally(() => {
      inFlightGetRequests.delete(requestKey);
    });
  }

  return requestPromise;
};

export const getApiBase = () => API_BASE;
