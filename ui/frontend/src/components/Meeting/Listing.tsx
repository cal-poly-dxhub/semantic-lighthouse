"use client";

import { Paper, Text, Badge, Group, Button } from "@mantine/core";
import { IconCalendar, IconFileText, IconVideo } from "@tabler/icons-react";

export interface MeetingListingProps {
  id: string;
  title: string;
  description: string;
  date: string;
  agendaUrl: string;
  status: "processing" | "completed" | "failed";
}

export function Listing({
  id,
  title,
  description,
  date,
  agendaUrl,
  status,
}: MeetingListingProps) {
  const getStatusColor = () => {
    switch (status) {
      case "processing":
        return "yellow";
      case "completed":
        return "green";
      case "failed":
        return "red";
      default:
        return "gray";
    }
  };

  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Paper p="md" withBorder radius="md" mb="md" shadow="xs">
      <Group mb="xs">
        <Text fw={700} size="lg">
          {title}
        </Text>
        <Badge color={getStatusColor()}>{status}</Badge>
      </Group>

      <Text size="sm" color="dimmed" mb="md" lineClamp={2}>
        {description}
      </Text>

      <Group>
        <Group>
          <IconCalendar size={16} />
          <Text size="sm">{formattedDate}</Text>
        </Group>

        <Group>
          <Button
            variant="outline"
            size="xs"
            component="a"
            href={agendaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Text size="sm" mr="xs">
              Agenda
            </Text>
            <IconFileText size={16} />
          </Button>
          <Button
            size="xs"
            component="a"
            href={`/video?id=${id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Group>
              <Text size="sm">Watch Video</Text>
              <IconVideo size={16} />
            </Group>
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
