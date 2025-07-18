"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const client_sns_1 = require("@aws-sdk/client-sns");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const cognitoClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({});
const snsClient = new client_sns_1.SNSClient({});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json",
};
const handler = async (event) => {
    console.log("INFO: received event:", JSON.stringify(event, null, 2));
    const { email, username } = JSON.parse(event.body || "{}");
    if (!email) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Email is required" }),
        };
    }
    try {
        // create user with temp password - sends user the email
        const createUserCommand = new client_cognito_identity_provider_1.AdminCreateUserCommand({
            UserPoolId: process.env.USER_POOL_ID,
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
        // add user to group
        const addUserToGroupCommand = new client_cognito_identity_provider_1.AdminAddUserToGroupCommand({
            UserPoolId: process.env.USER_POOL_ID,
            Username: username,
            GroupName: process.env.GROUP_NAME,
        });
        await cognitoClient.send(addUserToGroupCommand);
        console.log(`INFO: User ${email} added to group ${process.env.GROUP_NAME}`);
        // =================================================================
        // CREATE SNS TOPIC AND USER PREFERENCES FOR ADMIN-CREATED USER
        // =================================================================
        // 1. CREATE SNS TOPIC FOR THIS USER
        const topicName = `semantic-lighthouse-user-${username}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        const createTopicResponse = await snsClient.send(new client_sns_1.CreateTopicCommand({
            Name: topicName,
            Attributes: {
                DisplayName: `Semantic Lighthouse Notifications for ${username}`,
            },
        }));
        const topicArn = createTopicResponse.TopicArn;
        if (!topicArn) {
            throw new Error(`Failed to create SNS topic for user ${username}`);
        }
        console.log(`INFO: Created SNS topic ${topicArn} for user ${username}`);
        // 2. SUBSCRIBE USER EMAIL TO THEIR SNS TOPIC
        await snsClient.send(new client_sns_1.SubscribeCommand({
            TopicArn: topicArn,
            Protocol: "email",
            Endpoint: email,
        }));
        console.log(`INFO: Subscribed ${email} to topic ${topicArn}`);
        // 3. STORE USER PREFERENCES IN DYNAMODB
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: process.env.USER_PREFERENCES_TABLE_NAME,
            Item: {
                userId: { S: username },
                userEmail: { S: email },
                snsTopicArn: { S: topicArn },
                snsTopicName: { S: topicName },
                emailNotificationsEnabled: { BOOL: true },
                createdAt: { S: new Date().toISOString() },
                updatedAt: { S: new Date().toISOString() },
            },
        }));
        console.log(`INFO: Stored user preferences for ${username} in DynamoDB`);
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "User created successfully and invitation sent",
                username: email,
            }),
        };
    }
    catch (error) {
        console.error("ERROR: Error creating user:", error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Failed to create user" }),
        };
    }
};
exports.handler = handler;
