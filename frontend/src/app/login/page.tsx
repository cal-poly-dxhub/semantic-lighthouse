// filepath: /Users/gusflusser/DxHub/semantic-lighthouse/frontend/src/app/login/page.tsx
"use client";

import {
  Alert,
  Button,
  Container,
  Paper,
  PasswordInput,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../constants/AuthContext";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { handleLogin } = useAuth();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      emailOrUsername: "",
      password: "",
    },
  });

  const onSubmit = async (values: {
    emailOrUsername: string;
    password: string;
  }) => {
    setLoading(true);
    setError(null);

    handleLogin(
      values.emailOrUsername,
      values.password,
      () => {
        setLoading(false);
        router.push("/dashboard");
      },
      (err: unknown) => {
        setLoading(false);
        setError(
          (err as { message: string }).message ||
            "Login failed. Please try again."
        );
      }
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
        Login to Semantic Lighthouse
      </Title>

      <Paper withBorder shadow="md" p={30} mt={30} radius="md">
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}

        <form onSubmit={form.onSubmit(onSubmit)}>
          <TextInput
            label="Email or Username"
            placeholder="your@email.com or username"
            required
            {...form.getInputProps("emailOrUsername")}
          />
          <PasswordInput
            label="Password"
            placeholder="Your password"
            required
            mt="md"
            {...form.getInputProps("password")}
          />
          <Button
            type="submit"
            fullWidth
            mt="xl"
            loading={loading}
            style={{
              background: "linear-gradient(45deg, #1c7ed6, #339af0)",
            }}
          >
            Sign in
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
