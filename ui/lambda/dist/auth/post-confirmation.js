"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const client_sns_1 = require("@aws-sdk/client-sns");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const cognitoClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({});
const snsClient = new client_sns_1.SNSClient({});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const handler = async (event) => {
    console.log("INFO: received event:", JSON.stringify(event, null, 2));
    const { userName, userPoolId } = event;
    const userEmail = event.request.userAttributes.email;
    try {
        // =================================================================
        // 1. CREATE SNS TOPIC FOR THIS USER
        // =================================================================
        const topicName = `semantic-lighthouse-user-${userName}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        const createTopicResponse = await snsClient.send(new client_sns_1.CreateTopicCommand({
            Name: topicName,
            Attributes: {
                DisplayName: `Semantic Lighthouse Notifications for ${userName}`,
            },
        }));
        const topicArn = createTopicResponse.TopicArn;
        if (!topicArn) {
            throw new Error(`Failed to create SNS topic for user ${userName}`);
        }
        console.log(`INFO: Created SNS topic ${topicArn} for user ${userName}`);
        // =================================================================
        // 2. SUBSCRIBE USER EMAIL TO THEIR SNS TOPIC
        // =================================================================
        await snsClient.send(new client_sns_1.SubscribeCommand({
            TopicArn: topicArn,
            Protocol: "email",
            Endpoint: userEmail,
        }));
        console.log(`INFO: Subscribed ${userEmail} to topic ${topicArn}`);
        // =================================================================
        // 3. STORE USER PREFERENCES IN DYNAMODB
        // =================================================================
        await dynamoClient.send(new client_dynamodb_1.PutItemCommand({
            TableName: process.env.USER_PREFERENCES_TABLE_NAME,
            Item: {
                userId: { S: userName },
                userEmail: { S: userEmail },
                snsTopicArn: { S: topicArn },
                snsTopicName: { S: topicName },
                emailNotificationsEnabled: { BOOL: true },
                createdAt: { S: new Date().toISOString() },
                updatedAt: { S: new Date().toISOString() },
            },
        }));
        console.log(`INFO: Stored user preferences for ${userName} in DynamoDB`);
        // =================================================================
        // 4. EXISTING ADMIN LOGIC (FIRST USER SETUP)
        // =================================================================
        // get > 1 user from user pool
        const listUsersCommand = new client_cognito_identity_provider_1.ListUsersCommand({
            UserPoolId: userPoolId,
            Limit: 2,
        });
        const { Users } = await cognitoClient.send(listUsersCommand);
        console.log(`INFO: Found ${Users ? Users.length : 0} users in User Pool: ${userPoolId}`);
        if (Users && Users.length === 1) {
            console.log(`INFO: only one user detected ${userName}. Adding to Admins group.`);
            // add to admin group
            const adminAddUserToGroupCommand = new client_cognito_identity_provider_1.AdminAddUserToGroupCommand({
                UserPoolId: userPoolId,
                Username: userName,
                GroupName: process.env.ADMIN_GROUP_NAME,
            });
            await cognitoClient.send(adminAddUserToGroupCommand);
            console.log(`INFO: User ${userName} added to Admins group.`);
            // disable self-signup
            const updateUserPoolCommand = new client_cognito_identity_provider_1.UpdateUserPoolCommand({
                UserPoolId: userPoolId,
                AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
            });
            await cognitoClient.send(updateUserPoolCommand);
            console.log("INFO: Disabled self-signup successfully.");
        }
        else {
            console.warn(`WARN: Not the first user, no admin action needed in Post-Confirmation Lambda.`);
        }
    }
    catch (error) {
        console.error("ERROR: Error in Post-Confirmation Lambda:", error);
        throw error;
    }
    // return event to complete trigger
    return event;
};
exports.handler = handler;
