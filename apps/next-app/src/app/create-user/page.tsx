"use client";

import { useApiRequest } from "@/constants/apiRequest";
import {
  Alert,
  Button,
  Container,
  Paper,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";

export default function CreateUserPage() {
  const theme = useMantineTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { apiRequest } = useApiRequest();

  const form = useForm({
    initialValues: {
      email: "",
      username: "",
    },
    validate: {
      email: (value: string) =>
        /^\S+@\S+$/.test(value) ? null : "Invalid email",
      username: (value: string | unknown[]) =>
        value.length < 3 ? "Username must be at least 3 characters" : null,
    },
  });

  const onSubmit = async (values: { email: string; username: string }) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, status, error } = await apiRequest<{
        message: string;
        username: string;
      }>("POST", "users/create", {
        body: {
          email: values.email,
          username: values.username,
        },
      });

      if (status !== 200) {
        throw new Error(error || "Failed to create user");
      }

      if (!data || !data.username) {
        throw new Error("Unexpected response from server");
      }

      if (error) {
        throw new Error(error);
      }

      setSuccess(
        `User ${values.username} created successfully! An invitation email has been sent.`
      );

      form.reset();
    } catch (err) {
      const typedErr = err as { message: string };
      setError(typedErr.message || "Failed to create user. Please try again.");
    } finally {
      setLoading(false);
    }
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
        Create New User
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
            label="Email"
            placeholder="user@email.com"
            required
            {...form.getInputProps("email")}
          />
          <TextInput
            label="Username"
            placeholder="Choose a username"
            required
            mt="md"
            {...form.getInputProps("username")}
          />
          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            bg={theme.primaryColor}
          >
            Create User
          </Button>
        </form>

        <Text ta="center" mt="md" size="sm" c="dimmed">
          As an admin, you can create new user accounts that will be able to
          sign in to the system.
        </Text>
      </Paper>
    </Container>
  );
}
