import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getUser } from ".";
import { User } from "./types";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

export const update = async (
  userId: string,
  updates: Partial<Omit<User, "pk" | "sk">>
): Promise<User> => {
  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const updatedUser = {
    ...user,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: updatedUser,
    })
  );

  return updatedUser;
};
