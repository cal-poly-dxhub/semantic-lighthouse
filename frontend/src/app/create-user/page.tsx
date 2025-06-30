"use client";

import { Container, Text } from "@mantine/core";

// TODO: create user page
// TODO: redirect here after login with default admin user
// TODO: logout default admin user, then somehow delete default admin user, then login new user with credentials
export default function CreateUserPage() {
  return (
    <Container style={styles.container}>
      <Text>CreateUser</Text>
    </Container>
  );
}

const styles = {
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
};
