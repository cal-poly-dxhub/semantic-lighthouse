"use client";

import { useAuth } from "@/constants/AuthContext";
import {
  Alert,
  Button,
  Container,
  Paper,
  Progress,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { Dropzone, FileWithPath } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { IconCloudUpload, IconFile, IconVideo } from "@tabler/icons-react";
import { useState } from "react";

export default function UploadPage() {
  const theme = useMantineTheme();

  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoFile, setVideoFile] = useState<FileWithPath | null>(null);
  const [agendaFile, setAgendaFile] = useState<FileWithPath | null>(null);

  const form = useForm({
    initialValues: {
      meetingTitle: "",
      meetingDate: "",
      description: "",
    },
    validate: {
      meetingTitle: (value) =>
        value.length < 3 ? "Meeting title must be at least 3 characters" : null,
      meetingDate: (value) => (!value ? "Meeting date is required" : null),
    },
  });

  const handleVideoUpload = (files: FileWithPath[]) => {
    if (files.length > 0 && files.length <= 1) {
      const file = files[0];
      if (file.type.startsWith("video/")) {
        setVideoFile(file);
        setError(null);
      } else {
        setError("Please upload a valid video file");
      }
    } else {
      setError("Please upload one video file");
    }
  };

  const handleAgendaUpload = (files: FileWithPath[]) => {
    if (files.length > 0 && files.length <= 1) {
      const file = files[0];
      if (file.type === "application/pdf") {
        setAgendaFile(file);
        setError(null);
      } else {
        setError("Please upload a valid PDF file");
      }
    } else {
      setError("Please upload one PDF file");
    }
  };

  const onSubmit = async (values: {
    meetingTitle: string;
    meetingDate: string;
    description: string;
  }) => {
    if (!user) {
      setError("You must be logged in to upload files");
      return;
    }

    if (!videoFile) {
      setError("Please select a video file to upload");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      // TODO: Implement actual file upload to S3
      // This would involve:
      // 1. Getting presigned URLs for both video and agenda files
      // 2. Uploading files to S3
      // 3. Saving metadata to database

      setTimeout(() => {
        clearInterval(progressInterval);
        setUploadProgress(100);
        setLoading(false);
        setSuccess(
          `Meeting "${values.meetingTitle}" uploaded successfully! Processing will begin shortly.`
        );

        // reset form
        form.reset();
        setVideoFile(null);
        setAgendaFile(null);
        setUploadProgress(0);
      }, 2000);
    } catch (uploadError) {
      setLoading(false);
      setUploadProgress(0);
      setError("Upload failed. Please try again.");
      console.error("Upload error:", uploadError);
    }
  };

  if (!user) {
    return (
      <Container size={620} my={40}>
        <Title
          ta="center"
          style={{
            fontFamily: "Greycliff CF, var(--mantine-font-family)",
            fontWeight: 900,
          }}
        >
          Upload Board Meeting
        </Title>
        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          <Alert color="yellow" mb="md">
            Please log in to upload board meeting files.
          </Alert>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={620} my={40}>
      <Title
        ta="center"
        style={{
          fontFamily: "Greycliff CF, var(--mantine-font-family)",
          fontWeight: 900,
        }}
      >
        Upload Board Meeting
      </Title>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}

        {success && (
          <Alert color="green" mb="md">
            {success}
          </Alert>
        )}

        <form onSubmit={form.onSubmit(onSubmit)}>
          <TextInput
            label="Meeting Title"
            placeholder="Board Meeting - January 2024"
            required
            {...form.getInputProps("meetingTitle")}
          />

          <TextInput
            label="Meeting Date"
            placeholder="2024-01-15"
            required
            mt="md"
            type="date"
            {...form.getInputProps("meetingDate")}
          />

          <TextInput
            label="Description"
            placeholder="Brief description of the meeting (optional)"
            mt="md"
            {...form.getInputProps("description")}
          />

          <Text size="sm" fw={500} mt="md" mb="xs">
            Board Meeting Video *
          </Text>
          <Dropzone
            onDrop={handleVideoUpload}
            accept={["video/*"]}
            maxFiles={1}
            style={{
              border: videoFile ? "2px solid #51cf66" : "2px dashed #ced4da",
              borderRadius: "8px",
              padding: "20px",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ pointerEvents: "none" }}>
              {videoFile ? (
                <div>
                  <IconVideo
                    size={40}
                    color="#51cf66"
                    style={{ margin: "0 auto" }}
                  />
                  <Text size="sm" mt="xs">
                    {videoFile.name} (
                    {(videoFile.size / 1024 / 1024).toFixed(2)} MB)
                  </Text>
                </div>
              ) : (
                <div>
                  <IconCloudUpload
                    size={40}
                    color="#868e96"
                    style={{ margin: "0 auto" }}
                  />
                  <Text size="sm" mt="xs">
                    Drop video file here or click to select
                  </Text>
                  <Text size="xs" color="dimmed" mt="xs">
                    Supports MP4, MOV, AVI and other video formats
                  </Text>
                </div>
              )}
            </div>
          </Dropzone>

          <Text size="sm" fw={500} mt="md" mb="xs">
            Meeting Agenda (PDF)
          </Text>
          <Dropzone
            onDrop={handleAgendaUpload}
            accept={["application/pdf"]}
            maxFiles={1}
            style={{
              border: agendaFile ? "2px solid #51cf66" : "2px dashed #ced4da",
              borderRadius: "8px",
              padding: "20px",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <div style={{ pointerEvents: "none" }}>
              {agendaFile ? (
                <div>
                  <IconFile
                    size={40}
                    color="#51cf66"
                    style={{ margin: "0 auto" }}
                  />
                  <Text size="sm" mt="xs">
                    {agendaFile.name} (
                    {(agendaFile.size / 1024 / 1024).toFixed(2)} MB)
                  </Text>
                </div>
              ) : (
                <div>
                  <IconFile
                    size={40}
                    color="#868e96"
                    style={{ margin: "0 auto" }}
                  />
                  <Text size="sm" mt="xs">
                    Drop PDF file here or click to select (optional)
                  </Text>
                  <Text size="xs" color="dimmed" mt="xs">
                    Upload the meeting agenda for better analysis
                  </Text>
                </div>
              )}
            </div>
          </Dropzone>

          {loading && (
            <div style={{ marginTop: "1rem" }}>
              <Text size="sm" mb="xs">
                Uploading... {uploadProgress}%
              </Text>
              <Progress value={uploadProgress} />
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            disabled={!!success || !videoFile}
            bg={theme.primaryColor}
          >
            Upload Meeting Files
          </Button>
        </form>

        <Text ta="center" mt="md" size="sm" c="dimmed">
          Your files will be processed automatically and made available for
          analysis.
        </Text>
      </Paper>
    </Container>
  );
}
