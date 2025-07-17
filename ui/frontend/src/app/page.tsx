"use client";

import { Container, Paper, Text, Title, useMantineTheme } from "@mantine/core";
import { Listing, MeetingListingProps } from "@/components/Meeting/Listing";
import { useEffect, useState } from "react";
import { useApiRequest } from "@/constants/apiRequest";

// Mock data for meetings
const mockMeetings: MeetingListingProps[] = [
  {
    id: "meeting-1",
    title: "Q1 Board Meeting",
    description:
      "Quarterly board meeting discussing financial results and strategic initiatives for Q1 2024.",
    date: "2024-03-15",
    agendaUrl: "/mock-agenda-1.pdf",
    status: "completed",
  },
  {
    id: "meeting-2",
    title: "Strategic Planning Session",
    description:
      "Annual strategic planning session to outline goals and objectives for the upcoming fiscal year.",
    date: "2024-04-05",
    agendaUrl: "/mock-agenda-2.pdf",
    status: "processing",
  },
  {
    id: "meeting-3",
    title: "Budget Review Meeting",
    description:
      "Review of departmental budgets and allocation of resources for the next quarter.",
    date: "2024-04-20",
    agendaUrl: "/mock-agenda-3.pdf",
    status: "failed",
  },
];

export default function Home() {
  const theme = useMantineTheme();
  const { apiRequest } = useApiRequest();

  const [meetings, setMeetings] = useState<MeetingListingProps[]>();

  useEffect(() => {
    (async () => {
      const { data, status, error } = await apiRequest<
        {
          meetingId: string;
          meetingTitle: string;
          meetingDescription: string;
          meetingDate: string;
          videoVisibility: string;
          status: string;
          agendaS3Key: string;
        }[]
      >("GET", "meetings/all");

      /*
      {
        meetingId: item.meetingId?.S || "n/a",
        meetingTitle: item.meetingTitle?.S || "n/a",
        meetingDescription: item.meetingDescription?.S || "n/a",
        meetingDate: item.meetingDate?.S || "n/a",
        videoVisibility: item.videoVisibility?.S || "n/a",
        status: item.status?.S || "n/a",
        agendaS3Key: item.agendaS3Key?.S || "n/a",
      }

        id: string;
  title: string;
  description: string;
  date: string;
  agendaUrl: string;
  status: "processing" | "completed" | "failed";
        */

      // if (error || !data || data.data === null) {
      //   setMeetings(mockMeetings);
      // }

      console.log("INFO: meeting data:", status, data, error);

      setMeetings(
        data.data?.map((d) => ({
          id: d.meetingId,
          title: d.meetingTitle,
          description: d.meetingDescription,
          date: d.meetingDate,
          agendaUrl: d.agendaS3Key,
          status: d.status as MeetingListingProps["status"],
        }))
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container size="lg" my={30}>
      <Title order={2}>Board Meetings Dashboard</Title>
      <Text mb="xl" c="dimmed" pt="xs">
        AI-powered, template-driven, secure board meeting minutes generator.
      </Text>

      {!!meetings && meetings.length > 0 ? (
        <div>
          {meetings.map((meeting) => (
            <Listing
              key={meeting.id}
              id={meeting.id}
              title={meeting.title}
              description={meeting.description}
              date={meeting.date}
              agendaUrl={meeting.agendaUrl}
              status={meeting.status}
            />
          ))}
        </div>
      ) : (
        <Paper
          p="xl"
          shadow="xs"
          withBorder
          radius={theme.radius.md}
          ta="center"
        >
          <Text>
            No meetings found. Upload your first meeting to get started.
          </Text>
        </Paper>
      )}
    </Container>
  );
}
