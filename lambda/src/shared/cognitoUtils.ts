import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({});

export const createUserInCognito = async (
  username: string,
  email: string,
  userPoolId: string,
  groupName: string
) => {
  const createUserCommand = new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
      {
        Name: "email_verified",
        Value: "true",
      },
    ],
  });

  await cognitoClient.send(createUserCommand);
  console.log(`INFO: User ${email} created successfully`);

  const addUserToGroupCommand = new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: username,
    GroupName: groupName,
  });

  await cognitoClient.send(addUserToGroupCommand);
  console.log(`INFO: User ${email} added to group ${groupName}`);
};