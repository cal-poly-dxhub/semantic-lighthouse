"use client";

import { useApiRequest } from "@/constants/apiRequest";
import { useAuth } from "@/constants/AuthContext";
import { Alert, Paper, Title, useMantineTheme } from "@mantine/core";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

interface VideoRequestResponse {
  meetingId: string;
  presignedUrl: string;
}

export default function SuspenseWrap() {
  return (
    <Suspense>
      <VideoPage />
    </Suspense>
  );
}

const VideoPage = () => {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const time = searchParams.get("time");
  const videoRef = useRef<HTMLVideoElement>(null);
  const theme = useMantineTheme();

  const { token } = useAuth();
  const { apiRequest } = useApiRequest();

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * fetch presigned url from video id
   * @param route - "public-presigned" | "private-presigned"
   * @returns Promise<VideoRequestResponse>
   * @throws Error if no video ID is provided or if the fetch fails
   */
  const fetchVideoUrl: (
    route: "public-presigned" | "private-presigned"
  ) => Promise<VideoRequestResponse> = useCallback(
    async (route: "public-presigned" | "private-presigned") => {
      if (!id) {
        throw new Error("No video ID provided.");
      }

      try {
        const apiUrl = `${id}/${route}`;
        const { data, error, status } = await apiRequest<VideoRequestResponse>(
          "GET",
          apiUrl
        );

        if (error !== null) {
          throw new Error(`Failed to fetch video URL. Status: ${status}`);
        }

        return data;
      } catch (err) {
        throw new Error(
          `Error fetching video URL: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
      }
    },
    [apiRequest, id]
  );

  // fetch presigned url and setup video player
  useEffect(() => {
    (async () => {
      const videoElement = videoRef.current;
      if (!videoElement) {
        setError("Video element not found.");
        return;
      }

      try {
        const apiRoute = token ? "private-presigned" : "public-presigned";
        const response = await fetchVideoUrl(apiRoute);
        setVideoUrl(response.presignedUrl || null);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unknown error");
      }
    })();
  }, [fetchVideoUrl, id, token]);

  useEffect(() => {
    if (videoUrl && videoRef.current) {
      const videoElement = videoRef.current;

      const handleMetadataLoaded = () => {
        if (time) {
          const parsedTime = parseFloat(time);
          if (!isNaN(parsedTime) && videoElement) {
            console.log(`Setting video time to: ${parsedTime}`);
            videoElement.currentTime = parsedTime;
          }
        }
      };

      videoElement.addEventListener("loadedmetadata", handleMetadataLoaded);
      videoElement.src = videoUrl;

      return () => {
        videoElement.removeEventListener(
          "loadedmetadata",
          handleMetadataLoaded
        );
      };
    }
  }, [videoUrl, time]);

  useEffect(() => {
    if (videoUrl && videoRef.current) {
      videoRef.current.src = videoUrl;
    }
  }, [videoUrl]);

  return (
    <Paper
      p="xl"
      shadow="xs"
      w={900}
      mx="auto"
      mt={10}
      radius={theme.radius.lg}
    >
      <Title order={2} mb="md" ta="center">
        Semantic Lighthouse Video Player
      </Title>

      <Paper
        p="md"
        radius={theme.radius.md}
        style={{
          overflow: "hidden",
          backgroundColor: "#000",
        }}
      >
        <video
          ref={videoRef}
          controls
          width="100%"
          height="auto"
          style={{
            borderRadius: theme.radius.md,
            display: "block",
          }}
          autoPlay
          // TODO: remove muted
          muted
          key={videoUrl}
        >
          Your browser does not support the video tag.
        </video>
      </Paper>
      {error && (
        <Alert color="red" mt="md">
          {error}
        </Alert>
      )}
    </Paper>
  );
};
