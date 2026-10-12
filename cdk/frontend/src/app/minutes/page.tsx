"use client";

import { useApiRequest } from "@/constants/apiRequest";
import { useAuth } from "@/constants/AuthContext";
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Text,
  Title,
} from "@mantine/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

interface MinutesResponse {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  pdfUrl: string;
  htmlUrl: string;
}

export default function SuspenseWrap() {
  return (
    <Suspense>
      <MinutesPage />
    </Suspense>
  );
}

/**
 * The minutes email links here. The download links are signed for an hour,
 * so they're fetched fresh on every visit instead of being put in the email.
 */
const MinutesPage = () => {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const { user, isLoading } = useAuth();
  const { apiRequest } = useApiRequest();

  const [minutes, setMinutes] = useState<MinutesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !user) return;

    (async () => {
      const { data, error, status } = await apiRequest<MinutesResponse>(
        "GET",
        `${id}/minutes`
      );

      if (error === null) {
        setMinutes(data);
      } else if (status === 402) {
        setError(
          "These minutes are still being prepared. Check back in a few minutes."
        );
      } else if (status === 403) {
        setError(
          "These minutes belong to a different account. Sign in with the account that uploaded the meeting."
        );
      } else if (status === 404) {
        setError("Minutes for this meeting weren't found.");
      } else {
        setError(`Couldn't load the minutes (status ${status}).`);
      }
    })();
  }, [apiRequest, id, user]);

  const content = () => {
    if (!id) {
      return <Alert color="red">This link is missing the meeting ID.</Alert>;
    }
    if (isLoading) {
      return <Loader />;
    }
    if (!user) {
      return (
        <>
          <Text mb="md">Sign in to view and download these minutes.</Text>
          <Button
            component={Link}
            href={`/login?next=${encodeURIComponent(`/minutes?id=${id}`)}`}
          >
            Sign in
          </Button>
        </>
      );
    }
    if (error) {
      return <Alert color="red">{error}</Alert>;
    }
    if (!minutes) {
      return <Loader />;
    }
    return (
      <>
        <Title order={3}>{minutes.meetingTitle}</Title>
        {minutes.meetingDate && (
          <Text c="dimmed" mb="lg">
            {minutes.meetingDate}
          </Text>
        )}
        <Group>
          <Button component="a" href={minutes.pdfUrl}>
            Download PDF
          </Button>
          <Button
            component="a"
            href={minutes.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="light"
          >
            Open interactive minutes
          </Button>
        </Group>
        <Text size="sm" c="dimmed" mt="md">
          The PDF is ready to send. The interactive version links each item to
          that moment in the meeting video.
        </Text>
      </>
    );
  };

  return (
    <Container size={620} my={40}>
      <Title
        ta="center"
        style={{
          fontFamily: "Greycliff CF, var(--mantine-font-family)",
          fontWeight: 900,
        }}
      >
        Meeting Minutes
      </Title>
      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        {content()}
      </Paper>
    </Container>
  );
};
