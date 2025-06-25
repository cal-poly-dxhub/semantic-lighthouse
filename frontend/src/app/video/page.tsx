"use client";
import { Container, Text } from "@mantine/core";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Hls from "hls.js";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

const Video = () => {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const time = searchParams.get("time");
  const videoRef = useRef<HTMLVideoElement>(null);

  const m3u8Url = `${process.env.NEXT_PUBLIC_DISTRIBUTION_BASE_URL}/${id}/output.m3u8`;

  useEffect(() => {
    if (videoRef.current && id) {
      videoRef.current.src = m3u8Url;
      videoRef.current.load();
    }

    if (videoRef.current && time) {
      const parsedTime = parseFloat(time);
      if (!isNaN(parsedTime)) {
        videoRef.current.currentTime = parsedTime;
      }
    }

    if (videoRef.current && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(m3u8Url);
      hls.attachMedia(videoRef.current);
    }
  }, [id, m3u8Url, time]);

  return (
    <Container size="lg" py="xl">
      <Text size="xl" fw={700} ta="center" mb="md">
        Semantic Lighthouse Video Player
      </Text>

      {id ? (
        <div
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
            backgroundColor: "#000",
          }}
        >
          <video
            ref={videoRef}
            controls
            width="100%"
            height="450"
            style={{
              borderRadius: "12px",
              display: "block",
            }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      ) : (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            border: "2px dashed #e0e0e0",
            borderRadius: "12px",
            backgroundColor: "#f8f9fa",
          }}
        >
          <Text>Loading video...</Text>
        </div>
      )}
    </Container>
  );
};
export default Video;
