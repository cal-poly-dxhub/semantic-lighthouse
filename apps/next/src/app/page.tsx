"use client";

import { Meeting } from "@/components/Meeting";
import { useApiRequest } from "@/constants/apiRequest";
import { Paper, Text, Title, useMantineTheme } from "@mantine/core";
import { useEffect, useState } from "react";

export default function Home() {
  const theme = useMantineTheme();
  const { apiRequest } = useApiRequest();

  const [meetings, setMeetings] = useState<Meeting[]>([]);

  useEffect(() => {
    const fetchMeetings = async () => {
      const { data, error, status } = await apiRequest<Meeting[]>(
        "GET",
        "/all-meetings"
      );
      console.log({ data }, { error }, { status });
    };

    fetchMeetings();
  }, [apiRequest]);

  return (
    <Paper
      p="xl"
      shadow="xs"
      w={600}
      mx="auto"
      mt={50}
      radius={theme.radius.lg}
    >
      <Title order={2} mb="md">
        Welcome to Semantic Lighthouse
      </Title>
      <Text>
        AI-powered, template-driven, secure board meeting minutes generator.
      </Text>
    </Paper>
  );
}
