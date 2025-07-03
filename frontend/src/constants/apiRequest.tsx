import { useCallback } from "react";
import { useAuth } from "./AuthContext";

type ApiResponse<T> =
  | {
      data: T;
      error: null;
      status: number;
    }
  | {
      data: null;
      error: string;
      status: number;
    };

/**
 * hook for making api requests - handles errors and refreshing token
 * @returns Promise<T> - response from api request
 * @throws Error - if the request fails
 */
export const useApiRequest = () => {
  const { handleRefreshToken, token: authToken } = useAuth();

  const apiRequest = useCallback(
    async <T,>(
      method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
      url: string,
      options?: {
        headers?: Record<string, string>;
        body?: unknown;
        params?: Record<string, string>;
        query?: Record<string, string>;
      }
    ): Promise<ApiResponse<T>> => {
      let currentToken = authToken || localStorage.getItem("token");

      const { headers, body, params, query } = options || {};

      try {
        // refresh token if needed
        if (currentToken) {
          const tokenPayload = JSON.parse(atob(currentToken.split(".")[1]));
          const expiry = new Date(tokenPayload.exp * 1000);

          if (expiry <= new Date()) {
            console.log("Token expired, refreshing...");
            const refreshedToken = await handleRefreshToken();
            currentToken = refreshedToken || currentToken;
          }
        }

        const urlWithParams = new URL(url);
        if (params) {
          Object.entries(params).forEach(([key, value]) => {
            urlWithParams.searchParams.append(key, value);
          });
        }
        if (query) {
          Object.entries(query).forEach(([key, value]) => {
            urlWithParams.searchParams.append(key, value);
          });
        }

        const response = await fetch(urlWithParams, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            // if token present, send it with request
            ...(currentToken
              ? { Authorization: `Bearer ${currentToken}` }
              : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          return {
            data: null,
            error: data?.message || `HTTP error! status: ${response.status}`,
            status: response.status,
          };
        }

        return {
          data,
          error: null,
          status: response.status,
        };
      } catch (error) {
        console.error("API request failed:", error);
        return {
          data: null,
          error: error instanceof Error ? error.message : "Network error",
          status: 0,
        };
      }
    },
    [handleRefreshToken, authToken]
  );

  return { apiRequest };
};
