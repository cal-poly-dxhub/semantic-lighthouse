import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AuthStackProps {
  uniqueId: string;
  userPreferencesTable: cdk.aws_dynamodb.Table;
}

export class AuthResources extends Construct {
  public readonly userPool: cdk.aws_cognito.UserPool;
  public readonly userPoolClient: cdk.aws_cognito.UserPoolClient;
  public readonly defaultUserGroupName: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id);

    // reference stack
    const stack = cdk.Stack.of(this);

    // cannot get dynamically from group creation - circular dependency
    const adminGroupName = `SemanticLighthouseAdminsGroup-${props.uniqueId}`;
    this.defaultUserGroupName = `SemanticLighthouseUsersGroup-${props.uniqueId}`;

    this.userPool = new cdk.aws_cognito.UserPool(this, "UserPool", {
      signInAliases: {
        email: true,
        username: true,
      },
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = new cdk.aws_cognito.UserPoolClient(
      this,
      "UserPoolClient",
      {
        userPool: this.userPool,
        authFlows: {
          adminUserPassword: true,
          userPassword: true,
          custom: true,
          // once first user logs in, trigger disables self-signup
          userSrp: true,
        },
      }
    );

    // user groups
    this.userPool.addGroup("AdminsGroup", {
      groupName: adminGroupName,
      description: "Administrators group",
      precedence: 1,
    });

    this.userPool.addGroup("UsersGroup", {
      groupName: this.defaultUserGroupName,
      description: "Users group",
      precedence: 2,
    });

    // lambda to disable self-signup, add first user to admin group, and create SNS topics
    const postConfirmationLambda = new cdk.aws_lambda.Function(
      this,
      "PostConfirmationLambda",
      {
        description:
          "lambda function handling post-confirmation with SNS topic creation",
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/auth"),
        handler: "post-confirmation.handler",
        timeout: cdk.Duration.seconds(30),
        environment: {
          ADMIN_GROUP_NAME: adminGroupName,
          USER_PREFERENCES_TABLE_NAME: props.userPreferencesTable.tableName,
        },
        logGroup: new cdk.aws_logs.LogGroup(
          this,
          "PostConfirmationLambdaLogGroup",
          {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }
        ),
      }
    );

    // grant lambda permission to add users to groups and list users in the user pool
    postConfirmationLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:ListUsers",
          "cognito-idp:UpdateUserPool",
        ],
        resources: [
          // string version to avoid circular dependency
          `arn:aws:cognito-idp:${stack.region}:${stack.account}:userpool/*`,
        ],
      })
    );

    // grant lambda permission to create SNS topics and subscribe users
    postConfirmationLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["sns:CreateTopic", "sns:Subscribe", "sns:SetTopicAttributes"],
        resources: [
          `arn:aws:sns:${stack.region}:${stack.account}:semantic-lighthouse-user-*`,
        ],
      })
    );

    // grant lambda permission to write to user preferences table
    props.userPreferencesTable.grantWriteData(postConfirmationLambda);

    // trigger to signup first user and disable self-signup
    this.userPool.addTrigger(
      cdk.aws_cognito.UserPoolOperation.POST_CONFIRMATION,
      postConfirmationLambda
    );
  }
}
