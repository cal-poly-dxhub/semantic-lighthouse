"use client";

import { useAuth } from "@/constants/AuthContext";
import { Alert, Paper, Title, useMantineTheme } from "@mantine/core";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

interface VideoRequestResponse {
  videoId: string;
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

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // fetch presigned url and setup video player
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      setError("Video element not found.");
      return;
    }

    const fetchVideoUrl = async () => {
      if (!id) {
        setError("No video ID provided in the URL.");
        return;
      }

      try {
        if (!token) {
          // NOTE: this will display in dev, in prod will have lazy initialization (see AuthContext)
          setError("You are not authorized to view this video.");
          return;
        }

        const apiUrl = `${process.env.NEXT_PUBLIC_VIDEO_AUTH_API_URL}/private-presigned?videoId=${id}`;

        console.log(`Fetching video URL from: ${apiUrl}`);

        const response = await fetch(apiUrl, {
          headers: {
            Authorization: token,
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch video URL. Status: ${response.status}`
          );
        }

        const data: VideoRequestResponse = await response.json();
        setVideoUrl(data.presignedUrl);
      } catch (err) {
        console.error(err);
        setError(
          (err as { message?: string }).message ||
            "An error occurred while loading the video."
        );
      }
    };

    // run above functions
    fetchVideoUrl();
  }, [id, token]);

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
