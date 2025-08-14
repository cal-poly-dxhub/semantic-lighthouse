import { Container, Text } from "@mantine/core";
import { UUID } from "crypto";

export interface Meeting {
  id: UUID;
  name: string;
  status: string;
}

function Meeting({ id, name, status }: Meeting) {
  return (
    <Container style={styles.container}>
      <Text>Meeting {id}</Text>
      <Text>Name: {name}</Text>
      <Text>Status: {status}</Text>
    </Container>
  );
}

export default Meeting;

const styles = {
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
};
