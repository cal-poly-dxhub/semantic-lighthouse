"use client";

import { useApiRequest } from "@/constants/apiRequest";
import { useAuth } from "@/constants/AuthContext";
import {
  Alert,
  Button,
  Container,
  Paper,
  Progress,
  Select,
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
  const { apiRequest } = useApiRequest();

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
      visibility: "",
    },
    validate: {
      meetingTitle: (value: string) =>
        value.length < 3 ? "Meeting title must be at least 3 characters" : null,
      meetingDate: (value: string) =>
        !value ? "Meeting date is required" : null,
      description: (value: string) =>
        value.length > 500 ? "Description cannot exceed 500 characters" : null,
      visibility: (value: string) => (!value ? "Visibility is required" : null),
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
    visibility: string;
  }) => {
    if (!user) {
      setError("You must be logged in to upload files");
      return;
    }

    if (!videoFile) {
      setError("Please select a video file to upload");
      return;
    }

    if (!agendaFile) {
      setError("Please select an agenda PDF file to upload");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      // fetch presigned URLs from lambda
      const { data, error } = await apiRequest<{
        meetingId: string;
        videoPresignedUrl: string;
        agendaPresignedUrl: string;
      }>("POST", `${process.env.NEXT_PUBLIC_VIDEO_AUTH_API_URL}upload`, {
        body: {
          meetingTitle: values.meetingTitle,
          meetingDate: values.meetingDate,
          meetingDescription: values.description,
          videoVisibility: values.visibility,
        },
      });

      if (error !== null) {
        setLoading(false);
        setError(`Failed to get presigned URLs: ${error}`);
        return;
      }

      const { meetingId, videoPresignedUrl, agendaPresignedUrl } = data;

      console.log("Got presigned URLs for meetingId:", meetingId);

      // upload to s3
      setUploadProgress(10);
      const uploadFileWithProgress = async (
        url: string,
        file: File,
        contentType: string
      ) => {
        return new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              const fileProgress = (event.loaded / event.total) * 100;
              setUploadProgress(10 + fileProgress * 0.8);
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(new Response(xhr.response, { status: xhr.status }));
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Upload failed"));
          });

          xhr.open("PUT", url);
          xhr.setRequestHeader("Content-Type", contentType);
          xhr.send(file);
        });
      };

      await uploadFileWithProgress(videoPresignedUrl, videoFile, "video/mp4");

      // upload agenda to s3
      await uploadFileWithProgress(
        agendaPresignedUrl,
        agendaFile,
        "application/pdf"
      );

      setUploadProgress(100);
      setLoading(false);
      setSuccess(
        `Meeting "${values.meetingTitle}" uploaded successfully! Processing will begin shortly.`
      );

      // reset
      form.reset();
      setVideoFile(null);
      setAgendaFile(null);
      setUploadProgress(0);
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
    <Container size={620} my={20}>
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

          <Select
            label="Visibility"
            placeholder="Select visibility"
            required
            mt="md"
            data={[
              {
                value: "private",
                label: "Private - Only you can see this meeting",
              },
              {
                value: "public",
                label: "Public - Anyone can view this meeting",
              },
            ]}
            {...form.getInputProps("visibility")}
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
            Meeting Agenda (PDF) *
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
                    Drop PDF file here or click to select
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
                Uploading... {Math.round(uploadProgress)}%
              </Text>
              <Progress value={uploadProgress} />
            </div>
          )}

          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            disabled={!videoFile || !agendaFile}
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
